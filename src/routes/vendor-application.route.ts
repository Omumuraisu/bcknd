import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAdminCapability } from '../middleware/rbac.middleware.js';
import {
  approveVendorApplication,
  listPendingVendorApplicationsByBusiness,
  requestVendorApplicationCompliance,
} from '../services/admin-services/vendor-application.service.js';

const vendorApplicationRoutes = new Hono();
const isDevelopment = process.env.NODE_ENV !== 'production';

vendorApplicationRoutes.use(
  '*',
  cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

const toJsonSafe = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  ) as T;

const asTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

vendorApplicationRoutes.get('/', requireAdminCapability('admin:read'), async c => {
  try {
    const businessId = c.req.query('businessId');
    if (!businessId) {
      return c.json({ error: 'businessId query param is required' }, 400);
    }

    const pendingVendors = await listPendingVendorApplicationsByBusiness(businessId);
    return c.json({ pendingVendors: toJsonSafe(pendingVendors) });
  } catch (error) {
    console.error('GET /api/vendor-applications failed:', error);
    return c.json(
      {
        error: 'Failed to fetch pending vendor applications',
        ...(isDevelopment ? { details: String(error) } : {}),
      },
      500
    );
  }
});

vendorApplicationRoutes.post(
  '/:id/compliance-request',
  requireAdminCapability('admin:write'),
  async c => {
    try {
      const id = BigInt(c.req.param('id'));
      const body = (await c.req.json()) as Record<string, unknown>;

      const requiredDocuments = body.requiredDocuments;
      const note = asTrimmedString(body.note);

      const application = await requestVendorApplicationCompliance(
        id,
        requiredDocuments,
        note || undefined
      );

      return c.json({
        message: 'Compliance request sent',
        application: toJsonSafe(application),
      });
    } catch (error) {
      console.error('POST /api/vendor-applications/:id/compliance-request failed:', error);
      return c.json(
        {
          error: 'Failed to submit compliance request',
          ...(isDevelopment ? { details: String(error) } : {}),
        },
        500
      );
    }
  }
);

vendorApplicationRoutes.post('/:id/approve', requireAdminCapability('admin:write'), async c => {
  try {
    const id = BigInt(c.req.param('id'));

    const result = await approveVendorApplication(id);

    return c.json({
      message: 'Vendor application approved',
      vendor: toJsonSafe(result.vendor),
      application: toJsonSafe(result.application),
      reusedExistingVendor: result.reusedExistingVendor,
    });
  } catch (error) {
    console.error('POST /api/vendor-applications/:id/approve failed:', error);
    const code = (error as { code?: string })?.code;

    if (code === 'P2025') {
      return c.json({ error: 'Vendor application not found' }, 404);
    }

    return c.json(
      {
        error: 'Failed to approve vendor application',
        ...(isDevelopment ? { details: String(error) } : {}),
      },
      500
    );
  }
});

export default vendorApplicationRoutes;
