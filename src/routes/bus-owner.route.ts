import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { BusinessType, Role } from '../generated/prisma/client';
import {
  activateBusinessOwner,
  createUser,
  getUsers,
  getUserById,
  requestBusinessOwnerActivationOtp,
  updateUser,
  deleteUser,
} from '../services/admin-services/bus-owner.service.js';
import { requireAdminCapability } from '../middleware/rbac.middleware.js';
import {
  isLocalOtpProvider,
  otpProviderDisabledMessage,
  shouldExposeDevOtpCode,
} from '../lib/otp-provider.js';

const userRoutes = new Hono();

// ── CORS ──────────────────────────────────────────────────────────────────────
// Set ADMIN_FRONTEND_URL in .env (e.g. http://localhost:5173) to restrict origin
userRoutes.use(
  '*',
  cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const toJsonSafe = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  ) as T;

const BUSINESS_TYPES = new Set(Object.values(BusinessType));
const ROLES = new Set(Object.values(Role));
const isDevelopment = process.env.NODE_ENV !== 'production';

const mapDatabaseError = (error: unknown, fallbackMessage: string) => {
  const code = (error as { code?: string })?.code;

  if (code === 'P1001' || code === 'P2010') {
    return {
      status: 503 as const,
      body: {
        error: 'Database is unreachable',
        ...(isDevelopment ? { details: String(error) } : {}),
      },
    };
  }

  if (code === 'P1002') {
    return {
      status: 504 as const,
      body: {
        error: 'Database request timed out',
        ...(isDevelopment ? { details: String(error) } : {}),
      },
    };
  }

  return {
    status: 500 as const,
    body: {
      error: fallbackMessage,
      ...(isDevelopment ? { details: String(error) } : {}),
    },
  };
};

const pickFirst = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const asTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeCreateBusinessOwnerBody = (body: unknown) => {
  if (!body || typeof body !== 'object') {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Request body must be a JSON object',
    };
  }

  const input = body as Record<string, unknown>;

  const firstName = asTrimmedString(pickFirst(input, ['firstName', 'first_name']));
  const lastName = asTrimmedString(pickFirst(input, ['lastName', 'last_name']));
  const contact_number = asTrimmedString(
    pickFirst(input, ['contact_number', 'contactNumber', 'phone'])
  );
  const email = asTrimmedString(input.email);
  const businessName = asTrimmedString(
    pickFirst(input, ['businessName', 'business_name'])
  );
  const businessTypeRaw = asTrimmedString(
    pickFirst(input, ['businessType', 'business_type'])
  );
  const leaseDate = asTrimmedString(pickFirst(input, ['leaseDate', 'lease_date']));
  const stallIdRaw = pickFirst(input, ['stallId', 'stall_id']);
  const roleRaw = pickFirst(input, ['role']);

  const missing: string[] = [];
  if (!firstName) missing.push('firstName');
  if (!lastName) missing.push('lastName');
  if (!contact_number) missing.push('contact_number');
  if (!email) missing.push('email');
  if (!businessName) missing.push('businessName');
  if (!businessTypeRaw) missing.push('businessType');
  if (stallIdRaw === undefined) missing.push('stallId');
  if (!leaseDate) missing.push('leaseDate');

  if (missing.length > 0) {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Missing required fields',
      fields: missing,
    };
  }

  if (!BUSINESS_TYPES.has(businessTypeRaw as BusinessType)) {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Invalid businessType',
      allowed: Array.from(BUSINESS_TYPES),
    };
  }

  let stallId: bigint;
  try {
    stallId = BigInt(String(stallIdRaw));
  } catch {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Invalid stallId. Expected an integer value.',
    };
  }

  let role: Role | undefined;
  if (roleRaw !== undefined && roleRaw !== null) {
    const parsedRole = asTrimmedString(roleRaw);
    if (!ROLES.has(parsedRole as Role)) {
      return {
        ok: false as const,
        status: 400 as const,
        error: 'Invalid role',
        allowed: Array.from(ROLES),
      };
    }
    role = parsedRole as Role;
  }

  return {
    ok: true as const,
    data: {
      firstName,
      lastName,
      contact_number,
      email,
      businessName,
      businessType: businessTypeRaw as BusinessType,
      stallId,
      leaseDate,
      role,
    },
  };
};

const mapCreateUserError = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  const target = (error as { meta?: { target?: unknown } })?.meta?.target;

  if (code === 'P1001' || code === 'P1002') {
    return mapDatabaseError(error, 'Failed to create user');
  }

  if (code === 'P2002') {
    return {
      status: 409 as const,
      body: {
        error: 'Duplicate value violates a unique constraint',
        details: target ?? 'Unknown unique field',
      },
    };
  }

  if (code === 'P2003') {
    return {
      status: 400 as const,
      body: {
        error: 'Invalid reference for related record (likely stallId)',
      },
    };
  }

  if (code === 'P2025') {
    return {
      status: 404 as const,
      body: {
        error: 'A required related record was not found',
      },
    };
  }

  return {
    status: 500 as const,
    body: {
      error: 'Failed to register business owner',
      ...(isDevelopment ? { details: String(error) } : {}),
    },
  };
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET all business owners
userRoutes.get('/', requireAdminCapability('admin:read'), async (c) => {
  try {
    const users = await getUsers();
    return c.json({ users: toJsonSafe(users) });
  } catch (error) {
    console.error('GET /api/business-owners failed:', error);
    const mapped = mapDatabaseError(error, 'Failed to fetch users');
    return c.json(mapped.body, mapped.status);
  }
});

// GET business owner by id
userRoutes.get('/:id', requireAdminCapability('admin:read'), async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    const user = await getUserById(id);

    if (!user) return c.json({ error: 'User not found' }, 404);

    return c.json({ user: toJsonSafe(user) });
  } catch (error) {
    console.error('GET /api/business-owners/:id failed:', error);
    const mapped = mapDatabaseError(error, 'Failed to fetch user');
    return c.json(mapped.body, mapped.status);
  }
});

// POST create business owner
userRoutes.post('/', requireAdminCapability('admin:write'), async (c) => {
  try {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const normalized = normalizeCreateBusinessOwnerBody(body);

    if (!normalized.ok) {
      return c.json(
        {
          error: normalized.error,
          ...(normalized.fields ? { fields: normalized.fields } : {}),
          ...(normalized.allowed ? { allowed: normalized.allowed } : {}),
        },
        normalized.status
      );
    }

    const user = await createUser(normalized.data);
    return c.json(
      {
        user: toJsonSafe(user),
        message: 'Business owner registered in pending activation state',
      },
      201
    );
  } catch (error) {
    console.error('POST /api/business-owners failed:', error);
    const mapped = mapCreateUserError(error);
    return c.json(mapped.body, mapped.status);
  }
});

// POST request activation OTP for business owner
userRoutes.post('/request-activation', async (c) => {
  try {
    if (!isLocalOtpProvider()) {
      return c.json({ error: otpProviderDisabledMessage }, 503);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    const contactNumber = asTrimmedString(
      pickFirst(body, ['contact_number', 'contactNumber', 'phone'])
    );

    if (!contactNumber) {
      return c.json({ error: 'contact_number is required' }, 400);
    }

    const result = await requestBusinessOwnerActivationOtp(contactNumber);

    return c.json({
      message: 'OTP generated for activation',
      expiresAt: result.expiresAt,
      ...(shouldExposeDevOtpCode() ? { otpCode: result.otpCode } : {}),
    });
  } catch (error) {
    console.error('POST /api/business-owners/request-activation failed:', error);
    return c.json(
      {
        error: 'Failed to request activation OTP',
        ...(isDevelopment ? { details: String(error) } : {}),
      },
      400
    );
  }
});

// POST activate business owner account with OTP + password
userRoutes.post('/activate', async (c) => {
  try {
    if (!isLocalOtpProvider()) {
      return c.json({ error: otpProviderDisabledMessage }, 503);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    const contactNumber = asTrimmedString(
      pickFirst(body, ['contact_number', 'contactNumber', 'phone'])
    );
    const otp = asTrimmedString(body.otp);
    const password = asTrimmedString(body.password);

    if (!contactNumber || !otp || !password) {
      return c.json({ error: 'contact_number, otp, and password are required' }, 400);
    }

    const result = await activateBusinessOwner({
      contact_number: contactNumber,
      otp,
      password,
    });

    return c.json(result);
  } catch (error) {
    console.error('POST /api/business-owners/activate failed:', error);
    return c.json(
      {
        error: 'Failed to activate account',
        ...(isDevelopment ? { details: String(error) } : {}),
      },
      400
    );
  }
});

// PATCH update business owner profile (no password changes here)
userRoutes.patch('/:id', requireAdminCapability('admin:write'), async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    const body = await c.req.json();

    // Strip password if accidentally sent by the client
    const { password: _pw, ...safeBody } = body;

    const updatedUser = await updateUser(id, safeBody);
    return c.json({ user: toJsonSafe(updatedUser) });
  } catch (error) {
    console.error('PATCH /api/business-owners/:id failed:', error);
    const mapped = mapDatabaseError(error, 'Failed to update user');
    return c.json(mapped.body, mapped.status);
  }
});

// DELETE business owner (cascades vendors → businesses → businessOwner → account)
userRoutes.delete('/:id', requireAdminCapability('admin:delete'), async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    await deleteUser(id);
    return c.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/business-owners/:id failed:', error);
    const mapped = mapDatabaseError(error, 'Failed to delete user');
    return c.json(mapped.body, mapped.status);
  }
});

export default userRoutes;