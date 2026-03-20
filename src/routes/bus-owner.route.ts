import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
    const body = await c.req.json();
    const user = await createUser(body);
    return c.json({ user: toJsonSafe(user) }, 201);
  } catch (error) {
    console.error('POST /api/business-owners failed:', error);
    return c.json({ error: 'Failed to create user', details: String(error) }, 500);
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