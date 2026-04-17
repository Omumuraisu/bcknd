import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { Prisma } from '../generated/prisma/client';
import { canCreateAdminRole, requireAdminCapability } from '../middleware/rbac.middleware.js';
import {
  createPersonnel,
  deletePersonnel,
  getCurrentAdminProfile,
  listPersonnel,
  normalizeIncomingAdminRole,
  updateCurrentAdminProfile,
  updatePersonnel,
} from '../services/admin-settings.service.js';

const adminRoute = new Hono();

adminRoute.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

const parseIdParam = (value: string) => {
  if (!/^\d+$/.test(value)) {
    throw new Error('Invalid personnel id');
  }

  return BigInt(value);
};

const toErrorResponse = (c: Context, error: unknown) => {
  if (error instanceof Error) {
    const withFields = error as Error & { fields?: string[] };

    if (error.message === 'Invalid email format' || error.message.startsWith('Invalid role')) {
      return c.json({ error: error.message }, 400);
    }

    if (error.message === 'Missing required fields') {
      return c.json({ error: error.message, fields: withFields.fields ?? [] }, 400);
    }

    if (error.message === 'Admin profile not found') {
      return c.json({ error: error.message }, 404);
    }
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return c.json({ error: 'Duplicate value for unique field', details: error.meta }, 409);
    }

    if (error.code === 'P2003') {
      return c.json(
        {
          error:
            'Cannot delete personnel because related records still exist. Disable the account or remove related records first.',
          details: error.meta,
        },
        409
      );
    }

    if (error.code === 'P2025') {
      return c.json({ error: 'Record not found' }, 404);
    }

    if (error.code === 'P1001' || error.code === 'P1002') {
      return c.json({ error: 'Temporary database connection issue' }, 503);
    }
  }

  return c.json({ error: 'Failed to process request' }, 400);
};

adminRoute.get('/profile', requireAdminCapability('admin:read'), async c => {
  try {
    const auth = c.get('auth');
    const profile = await getCurrentAdminProfile(auth.accountId);
    return c.json(profile, 200);
  } catch (error) {
    return toErrorResponse(c, error);
  }
});

adminRoute.patch('/profile', requireAdminCapability('admin:write'), async c => {
  try {
    const auth = c.get('auth');
    const payload = await c.req.json();

    const profile = await updateCurrentAdminProfile(auth.accountId, {
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      role: payload.role,
      profileImageUrl: payload.profileImageUrl ?? payload.profile_image ?? payload.avatar_url,
    });

    return c.json(profile, 200);
  } catch (error) {
    return toErrorResponse(c, error);
  }
});

adminRoute.get('/personnel', requireAdminCapability('admin:read'), async c => {
  try {
    const personnel = await listPersonnel();
    return c.json({ personnel }, 200);
  } catch (error) {
    return toErrorResponse(c, error);
  }
});

adminRoute.post('/personnel', requireAdminCapability('admin:write'), async c => {
  try {
    const creatorAdminRole = c.get('adminRole');
    const payload = await c.req.json();
    const targetAdminRole = normalizeIncomingAdminRole(payload.role);

    if (!canCreateAdminRole(creatorAdminRole, targetAdminRole)) {
      return c.json({ error: 'Insufficient admin permissions for requested role' }, 403);
    }

    const personnel = await createPersonnel({
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      role: payload.role,
    });

    return c.json(personnel, 201);
  } catch (error) {
    return toErrorResponse(c, error);
  }
});

adminRoute.patch('/personnel/:id', requireAdminCapability('admin:write'), async c => {
  try {
    const accountId = parseIdParam(c.req.param('id'));
    const payload = await c.req.json();

    const personnel = await updatePersonnel(accountId, {
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      role: payload.role,
    });

    return c.json(personnel, 200);
  } catch (error) {
    return toErrorResponse(c, error);
  }
});

adminRoute.delete('/personnel/:id', requireAdminCapability('admin:delete'), async c => {
  try {
    const accountId = parseIdParam(c.req.param('id'));
    await deletePersonnel(accountId);
    return c.json({ message: 'Personnel deleted' }, 200);
  } catch (error) {
    return toErrorResponse(c, error);
  }
});

export default adminRoute;