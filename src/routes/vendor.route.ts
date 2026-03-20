import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createVendor,
  getVendorsByBusiness,
  deleteVendor,
} from '../services/admin-services/vendor.service.js';

const vendorRoutes = new Hono();

// ── CORS ──────────────────────────────────────────────────────────────────────
vendorRoutes.use(
  '*',
  cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const toJsonSafe = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  ) as T;

// ── Routes ────────────────────────────────────────────────────────────────────

// GET vendors by business  →  /api/vendor?businessId=123
vendorRoutes.get('/', async (c) => {
  try {
    const businessId = c.req.query('businessId');
    if (!businessId) {
      return c.json({ error: 'businessId query param is required' }, 400);
    }

    const vendors = await getVendorsByBusiness(businessId);
    return c.json({ vendors: toJsonSafe(vendors) });
  } catch (error) {
    console.error('GET /api/vendor failed:', error);
    return c.json({ error: 'Failed to fetch vendors' }, 500);
  }
});

// POST create vendor
// Body: { firstName, lastName, contact_number, accountId, businessId }
vendorRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { firstName, lastName, contact_number, accountId, businessId } = body;

    if (!firstName || !lastName || !contact_number || !accountId || !businessId) {
      return c.json(
        {
          error:
            'firstName, lastName, contact_number, accountId, and businessId are required',
        },
        400
      );
    }

    const vendor = await createVendor({
      firstName,
      lastName,
      contact_number,
      accountId,
      businessId,
    });
    return c.json({ vendor: toJsonSafe(vendor) }, 201);
  } catch (error) {
    console.error('POST /api/vendor failed:', error);
    return c.json({ error: 'Failed to create vendor', details: String(error) }, 500);
  }
});

// DELETE vendor by id
vendorRoutes.delete('/:id', async (c) => {
  try {
    const id = BigInt(c.req.param('id'));
    await deleteVendor(id);
    return c.json({ message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/vendor/:id failed:', error);
    return c.json({ error: 'Failed to delete vendor' }, 500);
  }
});

export default vendorRoutes;