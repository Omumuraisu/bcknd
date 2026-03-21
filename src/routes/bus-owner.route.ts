import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { BusinessType, Role } from '../generated/prisma/client';
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
} from '../services/admin-services/bus-owner.service.js';

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
  const password = asTrimmedString(input.password);
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
  if (!password) missing.push('password');
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
      password,
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
      error: 'Failed to create user',
      details: String(error),
    },
  };
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET all business owners
userRoutes.get('/', async (c) => {
  try {
    const users = await getUsers();
    return c.json({ users: toJsonSafe(users) });
  } catch (error) {
    console.error('GET /api/business-owners failed:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// GET business owner by id
userRoutes.get('/:id', async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    const user = await getUserById(id);

    if (!user) return c.json({ error: 'User not found' }, 404);

    return c.json({ user: toJsonSafe(user) });
  } catch (error) {
    console.error('GET /api/business-owners/:id failed:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

// POST create business owner
userRoutes.post('/', async (c) => {
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
    return c.json({ user: toJsonSafe(user) }, 201);
  } catch (error) {
    console.error('POST /api/business-owners failed:', error);
    const mapped = mapCreateUserError(error);
    return c.json(mapped.body, mapped.status);
  }
});

// PATCH update business owner profile (no password changes here)
userRoutes.patch('/:id', async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    const body = await c.req.json();

    // Strip password if accidentally sent by the client
    const { password: _pw, ...safeBody } = body;

    const updatedUser = await updateUser(id, safeBody);
    return c.json({ user: toJsonSafe(updatedUser) });
  } catch (error) {
    console.error('PATCH /api/business-owners/:id failed:', error);
    return c.json({ error: 'Failed to update user' }, 500);
  }
});

// DELETE business owner (cascades vendors → businesses → businessOwner → account)
userRoutes.delete('/:id', async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    await deleteUser(id);
    return c.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/business-owners/:id failed:', error);
    return c.json({ error: 'Failed to delete user' }, 500);
  }
});

export default userRoutes;