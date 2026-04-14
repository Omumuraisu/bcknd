import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Prisma, Role } from '../generated/prisma/client';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  completeUnloadingFromSync,
  getSyncDashboard,
  getTicketsSnapshot,
  getUnloadingSnapshot,
  startUnloadingFromSync,
  upsertTicketFromSync,
} from '../services/sync.service.js';

const syncRoutes = new Hono();

syncRoutes.use(
  '*',
  cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

const isDevelopment = process.env.NODE_ENV !== 'production';

const mapError = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P1001' || error.code === 'P1002') {
      return {
        status: 503 as const,
        body: { error: 'Temporary service dependency failure' },
      };
    }

    if (error.code === 'P2010') {
      return {
        status: 400 as const,
        body: {
          error: 'Invalid sync payload for database constraints',
          ...(isDevelopment ? { details: String(error) } : {}),
        },
      };
    }
  }

  return {
    status: 400 as const,
    body: {
      error: 'Failed to process sync request',
      ...(isDevelopment ? { details: String(error) } : {}),
    },
  };
};

const ensureSyncRole = async (c: Parameters<typeof requireAuth>[0], next: () => Promise<void>) => {
  let nextCalled = false;

  const authResponse = await requireAuth(c, async () => {
    nextCalled = true;
  });

  if (!nextCalled) {
    return authResponse;
  }

  const auth = c.get('auth');
  const allowed = auth.role === Role.Admin || auth.role === Role.Delivery_Operator;

  if (!allowed) {
    return c.json({ error: 'Forbidden for current role' }, 403);
  }

  await next();
};

syncRoutes.use('*', ensureSyncRole);

syncRoutes.post('/tickets', async c => {
  try {
    const payload = await c.req.json();
    const result = await upsertTicketFromSync(payload);
    return c.json(result.body, result.status);
  } catch (error) {
    const mapped = mapError(error);
    return c.json(mapped.body, mapped.status);
  }
});

syncRoutes.post('/unloading/start', async c => {
  try {
    const payload = await c.req.json();
    const result = await startUnloadingFromSync(payload);
    return c.json(result.body, result.status);
  } catch (error) {
    const mapped = mapError(error);
    return c.json(mapped.body, mapped.status);
  }
});

syncRoutes.post('/unloading/done', async c => {
  try {
    const payload = await c.req.json();
    const result = await completeUnloadingFromSync(payload);
    return c.json(result.body, result.status);
  } catch (error) {
    const mapped = mapError(error);
    return c.json(mapped.body, mapped.status);
  }
});

syncRoutes.get('/unloading/snapshot', async c => {
  try {
    return c.json(await getUnloadingSnapshot(), 200);
  } catch (error) {
    const mapped = mapError(error);
    return c.json(mapped.body, mapped.status);
  }
});

syncRoutes.get('/tickets/snapshot', async c => {
  try {
    return c.json(await getTicketsSnapshot(), 200);
  } catch (error) {
    const mapped = mapError(error);
    return c.json(mapped.body, mapped.status);
  }
});

syncRoutes.get('/dashboard', async c => {
  try {
    return c.json(await getSyncDashboard(), 200);
  } catch (error) {
    const mapped = mapError(error);
    return c.json(mapped.body, mapped.status);
  }
});

export default syncRoutes;
