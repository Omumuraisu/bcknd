import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getStalls } from '../services/stall.service.js';
const stallRoutes = new Hono();
stallRoutes.use('*', cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));
const toJsonSafe = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
stallRoutes.get('/', async (c) => {
    try {
        const stalls = await getStalls();
        return c.json({ stalls: toJsonSafe(stalls) });
    }
    catch (error) {
        console.error('GET /api/stalls failed:', error);
        return c.json({ error: 'Failed to fetch stalls' }, 500);
    }
});
export default stallRoutes;
