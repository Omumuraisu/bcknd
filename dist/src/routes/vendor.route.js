import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { activateVendor, createVendor, getVendorsByBusiness, requestVendorActivationOtp, deleteVendor, } from '../services/admin-services/vendor.service.js';
import { requireAdminCapability } from '../middleware/rbac.middleware.js';
import { isLocalOtpProvider, otpProviderDisabledMessage, shouldExposeDevOtpCode, } from '../lib/otp-provider.js';
const vendorRoutes = new Hono();
// ── CORS ──────────────────────────────────────────────────────────────────────
vendorRoutes.use('*', cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));
// ── Helpers ───────────────────────────────────────────────────────────────────
const toJsonSafe = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
const isDevelopment = process.env.NODE_ENV !== 'production';
const asTrimmedString = (value) => {
    if (typeof value !== 'string')
        return '';
    return value.trim();
};
// ── Routes ────────────────────────────────────────────────────────────────────
// GET vendors by business  →  /api/vendor?businessId=123
vendorRoutes.get('/', requireAdminCapability('admin:read'), async (c) => {
    try {
        const businessId = c.req.query('businessId');
        if (!businessId) {
            return c.json({ error: 'businessId query param is required' }, 400);
        }
        const vendors = await getVendorsByBusiness(businessId);
        return c.json({ vendors: toJsonSafe(vendors) });
    }
    catch (error) {
        console.error('GET /api/vendor failed:', error);
        return c.json({ error: 'Failed to fetch vendors' }, 500);
    }
});
// POST create vendor
// Body: { firstName, lastName, contact_number, businessId, email? }
vendorRoutes.post('/', requireAdminCapability('admin:write'), async (c) => {
    try {
        const body = (await c.req.json());
        const firstName = asTrimmedString(body.firstName ?? body.first_name);
        const lastName = asTrimmedString(body.lastName ?? body.last_name);
        const contact_number = asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone);
        const email = asTrimmedString(body.email);
        const businessIdRaw = body.businessId ?? body.business_id;
        if (!firstName || !lastName || !contact_number || businessIdRaw === undefined) {
            return c.json({
                error: 'firstName, lastName, contact_number, and businessId are required',
            }, 400);
        }
        let businessId;
        try {
            businessId = BigInt(String(businessIdRaw));
        }
        catch {
            return c.json({ error: 'Invalid businessId. Expected an integer value.' }, 400);
        }
        const vendor = await createVendor({
            firstName,
            lastName,
            contact_number,
            businessId,
            email: email || undefined,
        });
        return c.json({
            vendor: toJsonSafe(vendor),
            message: 'Vendor registered in pending activation state',
        }, 201);
    }
    catch (error) {
        console.error('POST /api/vendor failed:', error);
        return c.json({
            error: 'Failed to create vendor',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, 500);
    }
});
// POST request activation OTP for vendor
vendorRoutes.post('/request-activation', async (c) => {
    try {
        if (!isLocalOtpProvider()) {
            return c.json({ error: otpProviderDisabledMessage }, 503);
        }
        const body = (await c.req.json());
        const contactNumber = asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone);
        if (!contactNumber) {
            return c.json({ error: 'contact_number is required' }, 400);
        }
        const result = await requestVendorActivationOtp(contactNumber);
        return c.json({
            message: 'OTP generated for activation',
            expiresAt: result.expiresAt,
            ...(shouldExposeDevOtpCode() ? { otpCode: result.otpCode } : {}),
        });
    }
    catch (error) {
        console.error('POST /api/vendor/request-activation failed:', error);
        return c.json({
            error: 'Failed to request activation OTP',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, 400);
    }
});
// POST activate vendor account with OTP + password
vendorRoutes.post('/activate', async (c) => {
    try {
        if (!isLocalOtpProvider()) {
            return c.json({ error: otpProviderDisabledMessage }, 503);
        }
        const body = (await c.req.json());
        const contactNumber = asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone);
        const otp = asTrimmedString(body.otp);
        const password = asTrimmedString(body.password);
        if (!contactNumber || !otp || !password) {
            return c.json({ error: 'contact_number, otp, and password are required' }, 400);
        }
        const result = await activateVendor({
            contact_number: contactNumber,
            otp,
            password,
        });
        return c.json(result);
    }
    catch (error) {
        console.error('POST /api/vendor/activate failed:', error);
        return c.json({
            error: 'Failed to activate account',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, 400);
    }
});
// DELETE vendor by id
vendorRoutes.delete('/:id', requireAdminCapability('admin:delete'), async (c) => {
    try {
        const id = BigInt(c.req.param('id'));
        await deleteVendor(id);
        return c.json({ message: 'Vendor deleted successfully' });
    }
    catch (error) {
        console.error('DELETE /api/vendor/:id failed:', error);
        return c.json({ error: 'Failed to delete vendor' }, 500);
    }
});
export default vendorRoutes;
