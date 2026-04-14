import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

type SyncEntityType = 'unloading' | 'tickets';

type SyncEnvelope = {
  idempotencyKey: string;
  entityType: string;
  operation: string;
  entityId: string;
  payload: Record<string, unknown>;
  queuedAt?: string;
  sourceDeviceId?: string;
};

type ConflictResponse = {
  code: 'conflict';
  message: string;
  entityType: string;
  entityId: string;
  serverVersion: number;
  serverRecord: Record<string, unknown>;
  conflictFields: string[];
};

type SyncHttpStatus = 200 | 400 | 409 | 503;

type SyncResult =
  | { ok: true; status: SyncHttpStatus; body: { success: true; data: unknown } }
  | { ok: false; status: SyncHttpStatus; body: ConflictResponse | Record<string, unknown> };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asString = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return '';
};
const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

const asQueueNumberString = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (!Number.isInteger(value) || value < 0) return '';
    return String(value);
  }

  if (typeof value === 'bigint') {
    if (value < 0n) return '';
    return value.toString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /^\d+$/.test(trimmed) ? trimmed : '';
  }

  return '';
};

const toStableUuid = (value: string) => {
  const hash = createHash('sha256').update(`sync-legacy:${value}`).digest('hex');
  const chars = hash.slice(0, 32).split('');
  chars[12] = '5';
  const variant = (Number.parseInt(chars[16], 16) & 0x3) | 0x8;
  chars[16] = variant.toString(16);
  const compact = chars.join('');

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20, 32),
  ].join('-');
};

const normalizeEntityId = (value: unknown) => {
  const id = asString(value);
  if (!id) return '';
  if (UUID_REGEX.test(id)) return id.toLowerCase();
  return toStableUuid(id);
};

const normalizeEnvelope = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') {
    return { ok: false as const, body: { error: 'Request body must be a JSON object' } };
  }

  const body = raw as Record<string, unknown>;
  const idempotencyKey = asString(body.idempotencyKey);
  const entityType = asString(body.entityType);
  const operation = asString(body.operation);
  const entityId = normalizeEntityId(body.entityId);
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};

  const fields: string[] = [];
  if (!idempotencyKey) fields.push('idempotencyKey');
  if (!entityType) fields.push('entityType');
  if (!operation) fields.push('operation');
  if (!entityId) fields.push('entityId');
  if (!payload || typeof payload !== 'object') fields.push('payload');

  if (fields.length > 0) {
    return {
      ok: false as const,
      body: {
        error: 'Missing or invalid required fields',
        fields,
      },
    };
  }

  const normalizedPayload = payload;

  return {
    ok: true as const,
    data: {
      idempotencyKey,
      entityType,
      operation,
      entityId,
      payload: normalizedPayload,
      queuedAt: asString(body.queuedAt) || undefined,
      sourceDeviceId: asString(body.sourceDeviceId ?? normalizedPayload.source_device_id) || undefined,
    } satisfies SyncEnvelope,
  };
};

const toIsoValue = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  return value;
};

const diffFields = (payload: Record<string, unknown>, serverRecord: Record<string, unknown>) => {
  return Object.keys(payload).filter((key) => {
    if (key === 'version' || key === 'source_device_id') return false;
    const p = toIsoValue(payload[key]);
    const s = toIsoValue(serverRecord[key]);
    return JSON.stringify(p) !== JSON.stringify(s);
  });
};

const hashRequest = (envelope: SyncEnvelope) => {
  return createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
};

const toSyncStatus = (value: number): SyncHttpStatus => {
  if (value === 400 || value === 409 || value === 503) return value;
  return 200;
};

const idempotencyLookup = async (
  key: string,
  entityType: string,
  operation: string
): Promise<{ response_status: number; response_payload: unknown; request_hash: string } | null> => {
  const rows = (await prisma.$queryRawUnsafe(
    `
      select response_status, response_payload, request_hash
      from public.sync_idempotency_ledger
      where idempotency_key = $1 and entity_type = $2 and operation = $3
      limit 1
    `,
    key,
    entityType,
    operation
  )) as Array<{ response_status: number; response_payload: unknown; request_hash: string }>;

  return rows[0] ?? null;
};

const idempotencyStore = async (
  envelope: SyncEnvelope,
  requestHash: string,
  status: number,
  payload: unknown
) => {
  await prisma.$executeRawUnsafe(
    `
      insert into public.sync_idempotency_ledger
      (idempotency_key, entity_type, operation, entity_id, request_hash, response_status, response_payload)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (idempotency_key, entity_type, operation) do nothing
    `,
    envelope.idempotencyKey,
    envelope.entityType,
    envelope.operation,
    envelope.entityId,
    requestHash,
    status,
    JSON.stringify(payload)
  );
};

const withIdempotency = async (
  envelope: SyncEnvelope,
  run: () => Promise<SyncResult>
): Promise<SyncResult> => {
  const requestHash = hashRequest(envelope);
  const replay = await idempotencyLookup(
    envelope.idempotencyKey,
    envelope.entityType,
    envelope.operation
  );

  if (replay) {
    if (replay.request_hash !== requestHash) {
      return {
        ok: false,
        status: 409,
        body: {
          code: 'conflict',
          message: 'idempotencyKey was already used with a different payload',
          entityType: envelope.entityType,
          entityId: envelope.entityId,
          serverVersion: 0,
          serverRecord: {},
          conflictFields: ['idempotencyKey'],
        },
      };
    }

    return {
      ok: true,
      status: toSyncStatus(replay.response_status),
      body: replay.response_payload as { success: true; data: unknown },
    };
  }

  const result = await run();
  await idempotencyStore(envelope, requestHash, result.status, result.body);
  return result;
};

const readUnloadingById = async (id: string) => {
  const rows = (await prisma.$queryRawUnsafe(
    `select * from public.sync_unloading_record where id = $1 limit 1`,
    id
  )) as Array<Record<string, unknown>>;

  return rows[0] ?? null;
};

const readTicketById = async (id: string) => {
  const rows = (await prisma.$queryRawUnsafe(
    `select * from public.sync_ticket_record where id = $1 limit 1`,
    id
  )) as Array<Record<string, unknown>>;

  return rows[0] ?? null;
};

const buildConflict = (
  entityType: SyncEntityType,
  entityId: string,
  message: string,
  serverRecord: Record<string, unknown>,
  payload: Record<string, unknown>
): SyncResult => {
  const serverVersion = asNumber(serverRecord.version) ?? 0;
  return {
    ok: false,
    status: 409,
    body: {
      code: 'conflict',
      message,
      entityType,
      entityId,
      serverVersion,
      serverRecord,
      conflictFields: diffFields(payload, serverRecord),
    },
  };
};

const requirePayloadFields = (payload: Record<string, unknown>, fields: string[]) => {
  const missing = fields.filter((field) => {
    const value = payload[field];
    if (typeof value === 'string') return value.trim() === '';
    return value === undefined || value === null;
  });

  if (missing.length > 0) {
    return {
      ok: false as const,
      body: {
        error: 'Missing required payload fields',
        fields: missing,
      },
    };
  }

  return { ok: true as const };
};

export const upsertTicketFromSync = async (raw: unknown): Promise<SyncResult> => {
  const normalized = normalizeEnvelope(raw);
  if (!normalized.ok) return { ok: false, status: 400, body: normalized.body };
  const envelope = normalized.data;

  return withIdempotency(envelope, async () => {
    const required = requirePayloadFields(envelope.payload, [
      'transaction_id',
      'ticket_no',
      'vehicle_number',
      'vehicle_type',
      'goods_type',
      'unloading_time',
      'suggested_unloading_time',
      'total_amount',
      'issued_at',
      'items',
    ]);

    if (!required.ok) return { ok: false, status: 400, body: required.body };

    const transactionRows = (await prisma.$queryRawUnsafe(
      `select * from public.sync_ticket_record where transaction_id = $1 limit 1`,
      asString(envelope.payload.transaction_id)
    )) as Array<Record<string, unknown>>;

    if (transactionRows[0] && transactionRows[0].id !== envelope.entityId) {
      return buildConflict(
        'tickets',
        envelope.entityId,
        'transaction_id already exists on another record',
        transactionRows[0],
        envelope.payload
      );
    }

    const existing = await readTicketById(envelope.entityId);

    if (!existing) {
      const rows = (await prisma.$queryRawUnsafe(
        `
          insert into public.sync_ticket_record
            (id, transaction_id, ticket_no, vehicle_number, vehicle_type, goods_type,
             unloading_time, suggested_unloading_time, total_amount, issued_at, items, source_device_id, last_idempotency_key)
          values
            ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::numeric, $10::timestamptz,
             $11::jsonb, $12, $13)
          returning *
        `,
        envelope.entityId,
        asString(envelope.payload.transaction_id),
        asString(envelope.payload.ticket_no),
        asString(envelope.payload.vehicle_number),
        asString(envelope.payload.vehicle_type),
        asString(envelope.payload.goods_type),
        asString(envelope.payload.unloading_time),
        asString(envelope.payload.suggested_unloading_time),
        asNumber(envelope.payload.total_amount) ?? 0,
        asString(envelope.payload.issued_at),
        JSON.stringify(envelope.payload.items),
        envelope.sourceDeviceId ?? null,
        envelope.idempotencyKey
      )) as Array<Record<string, unknown>>;

      return { ok: true, status: 200, body: { success: true, data: rows[0] } };
    }

    const expectedVersion = asNumber(envelope.payload.version);
    const actualVersion = asNumber(existing.version) ?? 0;

    if (expectedVersion === null) {
      return {
        ok: false,
        status: 400,
        body: { error: 'payload.version is required for updates', fields: ['payload.version'] },
      };
    }

    if (expectedVersion !== actualVersion) {
      return buildConflict('tickets', envelope.entityId, 'Ticket version mismatch', existing, envelope.payload);
    }

    const rows = (await prisma.$queryRawUnsafe(
      `
        update public.sync_ticket_record
        set
          transaction_id = $2,
          ticket_no = $3,
          vehicle_number = $4,
          vehicle_type = $5,
          goods_type = $6,
          unloading_time = $7::timestamptz,
          suggested_unloading_time = $8::timestamptz,
          total_amount = $9::numeric,
          issued_at = $10::timestamptz,
          items = $11::jsonb,
          source_device_id = $12,
          last_idempotency_key = $13,
          deleted_at = null
        where id = $1
        returning *
      `,
      envelope.entityId,
      asString(envelope.payload.transaction_id),
      asString(envelope.payload.ticket_no),
      asString(envelope.payload.vehicle_number),
      asString(envelope.payload.vehicle_type),
      asString(envelope.payload.goods_type),
      asString(envelope.payload.unloading_time),
      asString(envelope.payload.suggested_unloading_time),
      asNumber(envelope.payload.total_amount) ?? 0,
      asString(envelope.payload.issued_at),
      JSON.stringify(envelope.payload.items),
      envelope.sourceDeviceId ?? null,
      envelope.idempotencyKey
    )) as Array<Record<string, unknown>>;

    return { ok: true, status: 200, body: { success: true, data: rows[0] } };
  });
};

const upsertUnloading = async (raw: unknown, markDone: boolean): Promise<SyncResult> => {
  const normalized = normalizeEnvelope(raw);
  if (!normalized.ok) return { ok: false, status: 400, body: normalized.body };
  const envelope = normalized.data;

  return withIdempotency(envelope, async () => {
    const required = requirePayloadFields(envelope.payload, [
      'queue_number',
      'vehicle_number',
      'vehicle_type',
      'product_category',
      'started_at',
      'estimated_minutes',
    ]);

    if (!required.ok) return { ok: false, status: 400, body: required.body };

    const normalizedQueueNumber = asQueueNumberString(envelope.payload.queue_number);
    if (!normalizedQueueNumber) {
      return {
        ok: false,
        status: 400,
        body: { error: 'queue_number must be a non-negative integer', fields: ['queue_number'] },
      };
    }

    const existing = await readUnloadingById(envelope.entityId);

    if (!existing) {
      const rows = (await prisma.$queryRawUnsafe(
        `
          insert into public.sync_unloading_record
            (id, queue_number, vehicle_number, vehicle_type, product_category,
             started_at, estimated_minutes, completed_at, source_device_id, last_idempotency_key)
          values
            ($1, $2, $3, $4, $5, $6::timestamptz, $7::int, $8::timestamptz, $9, $10)
          returning *
        `,
        envelope.entityId,
        normalizedQueueNumber,
        asString(envelope.payload.vehicle_number),
        asString(envelope.payload.vehicle_type),
        asString(envelope.payload.product_category),
        asString(envelope.payload.started_at),
        asNumber(envelope.payload.estimated_minutes) ?? 0,
        markDone ? asString(envelope.payload.completed_at) || new Date().toISOString() : null,
        envelope.sourceDeviceId ?? null,
        envelope.idempotencyKey
      )) as Array<Record<string, unknown>>;

      return { ok: true, status: 200, body: { success: true, data: rows[0] } };
    }

    const expectedVersion = asNumber(envelope.payload.version);
    const actualVersion = asNumber(existing.version) ?? 0;

    if (expectedVersion === null) {
      return {
        ok: false,
        status: 400,
        body: { error: 'payload.version is required for updates', fields: ['payload.version'] },
      };
    }

    if (expectedVersion !== actualVersion) {
      return buildConflict(
        'unloading',
        envelope.entityId,
        'Unloading record version mismatch',
        existing,
        envelope.payload
      );
    }

    const rows = (await prisma.$queryRawUnsafe(
      `
        update public.sync_unloading_record
        set
          queue_number = $2,
          vehicle_number = $3,
          vehicle_type = $4,
          product_category = $5,
          started_at = $6::timestamptz,
          estimated_minutes = $7::int,
          completed_at = case when $8::boolean then coalesce($9::timestamptz, now()) else null end,
          source_device_id = $10,
          last_idempotency_key = $11,
          deleted_at = null
        where id = $1
        returning *
      `,
      envelope.entityId,
      normalizedQueueNumber,
      asString(envelope.payload.vehicle_number),
      asString(envelope.payload.vehicle_type),
      asString(envelope.payload.product_category),
      asString(envelope.payload.started_at),
      asNumber(envelope.payload.estimated_minutes) ?? 0,
      markDone,
      asString(envelope.payload.completed_at) || null,
      envelope.sourceDeviceId ?? null,
      envelope.idempotencyKey
    )) as Array<Record<string, unknown>>;

    return { ok: true, status: 200, body: { success: true, data: rows[0] } };
  });
};

export const startUnloadingFromSync = async (raw: unknown) => upsertUnloading(raw, false);
export const completeUnloadingFromSync = async (raw: unknown) => upsertUnloading(raw, true);

export const getUnloadingSnapshot = async () => {
  const rows = (await prisma.$queryRawUnsafe(
    `select * from public.sync_unloading_record order by updated_at desc, id asc`
  )) as Array<Record<string, unknown>>;

  return { success: true, data: rows };
};

export const getTicketsSnapshot = async () => {
  const rows = (await prisma.$queryRawUnsafe(
    `select * from public.sync_ticket_record order by updated_at desc, id asc`
  )) as Array<Record<string, unknown>>;

  return { success: true, data: rows };
};

export const getSyncDashboard = async () => {
  const totals = (await prisma.$queryRawUnsafe(
    `
      select
        coalesce(
          (select sum(total_amount) from public.sync_ticket_record where deleted_at is null),
          0
        ) as total_amount_issued,
        coalesce(
          (select count(*) from public.sync_unloading_record where deleted_at is null and completed_at is not null),
          0
        ) as total_deliveries
    `
  )) as Array<{ total_amount_issued: string | number; total_deliveries: string | number }>;

  const waiting = (await prisma.$queryRawUnsafe(
    `
      select coalesce(count(*), 0) as waiting_vehicles
      from public.sync_unloading_record u
      where u.deleted_at is null
        and u.completed_at is null
    `
  )) as Array<{ waiting_vehicles: string | number }>;

  return {
    success: true,
    data: {
      totalAmountIssued: Number(totals[0]?.total_amount_issued ?? 0),
      totalDeliveries: Number(totals[0]?.total_deliveries ?? 0),
      waitingVehicles: Number(waiting[0]?.waiting_vehicles ?? 0),
    },
  };
};
