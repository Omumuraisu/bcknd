import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { activateDeliveryOperator, createDeliveryOperator, deleteDeliveryOperator, getDeliveryOperatorSelfProfile, getDeliveryOperatorById, getDeliveryOperators, requestDeliveryOpActivationOtp, updateDeliveryOperatorSelfProfile, updateDeliveryOperator, } from '../services/admin-services/delivery-op.service.js';
import { requireAdminCapability } from '../middleware/rbac.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { Role } from '../generated/prisma/client.js';
import { isLocalOtpProvider, otpProviderDisabledMessage, shouldExposeDevOtpCode, } from '../lib/otp-provider.js';
import { refreshDeliveryOperatorAccessToken } from '../services/auth.service.js';
const hubStaffRoutes = new Hono();
hubStaffRoutes.use('*', cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));
const toJsonSafe = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
const asTrimmedString = (value) => {
    if (typeof value !== 'string')
        return '';
    return value.trim();
};
const isDevelopment = process.env.NODE_ENV !== 'production';
const mapDatabaseError = (error, fallbackMessage) => {
    const code = error?.code;
    if (code === 'P1001' || code === 'P2010') {
        return {
            status: 503,
            body: {
                error: 'Database is unreachable',
                ...(isDevelopment ? { details: String(error) } : {}),
            },
        };
    }
    if (code === 'P1002') {
        return {
            status: 504,
            body: {
                error: 'Database request timed out',
                ...(isDevelopment ? { details: String(error) } : {}),
            },
        };
    }
    return {
        status: 500,
        body: {
            error: fallbackMessage,
            ...(isDevelopment ? { details: String(error) } : {}),
        },
    };
};
const requireDeliveryOperatorAuth = async (c, next) => {
    let nextCalled = false;
    const authResponse = await requireAuth(c, async () => {
        nextCalled = true;
    });
    if (!nextCalled) {
        return authResponse;
    }
    const auth = c.get('auth');
    if (auth.role !== Role.Delivery_Operator) {
        return c.json({ error: 'Delivery operator account required' }, 403);
    }
    await next();
};
hubStaffRoutes.post('/refresh', async (c) => {
    try {
        const body = (await c.req.json());
        const refreshToken = asTrimmedString(body.refreshToken ?? body.refresh_token);
        if (!refreshToken) {
            return c.json({ error: 'refreshToken is required', fields: ['refreshToken'] }, 400);
        }
        const result = await refreshDeliveryOperatorAccessToken(refreshToken);
        return c.json(result.body, result.status);
    }
    catch (error) {
        const mapped = mapDatabaseError(error, 'Failed to refresh access token');
        return c.json(mapped.body, mapped.status);
    }
});
hubStaffRoutes.get('/me', requireDeliveryOperatorAuth, async (c) => {
    try {
        const auth = c.get('auth');
        const profile = await getDeliveryOperatorSelfProfile(auth.accountId);
        return c.json({ profile }, 200);
    }
    catch (error) {
        const message = String(error);
        return c.json({
            error: message.includes('profile not found')
                ? 'Delivery operator profile not found'
                : 'Failed to load profile',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, message.includes('profile not found') ? 404 : 400);
    }
});
hubStaffRoutes.patch('/profile', requireDeliveryOperatorAuth, async (c) => {
    try {
        const auth = c.get('auth');
        const body = (await c.req.json());
        const fullName = asTrimmedString(body.fullName ?? body.full_name);
        const phone = asTrimmedString(body.phone ?? body.contact_number ?? body.contactNumber);
        if (!fullName && !phone) {
            return c.json({
                error: 'At least one profile field is required',
                fields: ['fullName', 'phone'],
            }, 400);
        }
        const profile = await updateDeliveryOperatorSelfProfile(auth.accountId, {
            fullName: fullName || undefined,
            phone: phone || undefined,
        });
        return c.json({ profile }, 200);
    }
    catch (error) {
        const message = String(error);
        return c.json({
            error: message.includes('profile not found')
                ? 'Delivery operator profile not found'
                : message.includes('At least one profile field is required')
                    ? 'At least one profile field is required'
                    : 'Failed to update profile',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, message.includes('profile not found') ? 404 : 400);
    }
});
hubStaffRoutes.get('/', requireAdminCapability('admin:read'), async (c) => {
    try {
        const operators = await getDeliveryOperators();
        return c.json({ hubStaff: toJsonSafe(operators) });
    }
    catch (error) {
        console.error('GET /api/hub-staff failed:', error);
        const mapped = mapDatabaseError(error, 'Failed to fetch hub staff');
        return c.json(mapped.body, mapped.status);
    }
});
hubStaffRoutes.get('/:id', requireAdminCapability('admin:read'), async (c) => {
    try {
        const id = BigInt(c.req.param('id'));
        const operator = await getDeliveryOperatorById(id);
        if (!operator) {
            return c.json({ error: 'Hub staff not found' }, 404);
        }
        return c.json({ hubStaff: toJsonSafe(operator) });
    }
    catch (error) {
        console.error('GET /api/hub-staff/:id failed:', error);
        const mapped = mapDatabaseError(error, 'Failed to fetch hub staff');
        return c.json(mapped.body, mapped.status);
    }
});
hubStaffRoutes.post('/', requireAdminCapability('admin:write'), async (c) => {
    try {
        const body = await c.req.json();
        const firstName = asTrimmedString(body.firstName ?? body.first_name);
        const lastName = asTrimmedString(body.lastName ?? body.last_name);
        const contactNumber = asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone);
        const email = asTrimmedString(body.email);
        if (!firstName || !lastName || !contactNumber) {
            return c.json({
                error: 'firstName, lastName, and contact_number are required',
            }, 400);
        }
        const created = await createDeliveryOperator({
            first_name: firstName,
            last_name: lastName,
            contact_number: contactNumber,
            email: email || undefined,
        });
        return c.json({
            hubStaff: toJsonSafe(created),
            message: 'Hub staff registered in pending activation state',
        }, 201);
    }
    catch (error) {
        console.error('POST /api/hub-staff failed:', error);
        return c.json({
            error: 'Failed to register hub staff',
            details: process.env.NODE_ENV !== 'production' ? String(error) : undefined,
        }, 500);
    }
});
hubStaffRoutes.patch('/:id', requireAdminCapability('admin:write'), async (c) => {
    try {
        const id = BigInt(c.req.param('id'));
        const body = (await c.req.json());
        const updated = await updateDeliveryOperator(id, {
            firstName: asTrimmedString(body.firstName ?? body.first_name),
            lastName: asTrimmedString(body.lastName ?? body.last_name),
            contact_number: asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone),
            email: asTrimmedString(body.email) || undefined,
        });
        return c.json({ hubStaff: toJsonSafe(updated) });
    }
    catch (error) {
        console.error('PATCH /api/hub-staff/:id failed:', error);
        const mapped = mapDatabaseError(error, 'Failed to update hub staff');
        return c.json(mapped.body, mapped.status);
    }
});
hubStaffRoutes.delete('/:id', requireAdminCapability('admin:delete'), async (c) => {
    try {
        const id = BigInt(c.req.param('id'));
        await deleteDeliveryOperator(id);
        return c.json({ message: 'Hub staff deleted successfully' });
    }
    catch (error) {
        console.error('DELETE /api/hub-staff/:id failed:', error);
        const mapped = mapDatabaseError(error, 'Failed to delete hub staff');
        return c.json(mapped.body, mapped.status);
    }
});
hubStaffRoutes.post('/request-activation', async (c) => {
    try {
        if (!isLocalOtpProvider()) {
            return c.json({ error: otpProviderDisabledMessage }, 503);
        }
        const body = await c.req.json();
        const contactNumber = asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone);
        if (!contactNumber) {
            return c.json({ error: 'contact_number is required' }, 400);
        }
        const result = await requestDeliveryOpActivationOtp(contactNumber);
        return c.json({
            message: 'OTP generated for activation',
            expiresAt: result.expiresAt,
            ...(shouldExposeDevOtpCode() ? { otpCode: result.otpCode } : {}),
        });
    }
    catch (error) {
        console.error('POST /api/hub-staff/request-activation failed:', error);
        return c.json({
            error: 'Failed to request activation OTP',
            details: process.env.NODE_ENV !== 'production' ? String(error) : undefined,
        }, 400);
    }
});
hubStaffRoutes.post('/activate', async (c) => {
    try {
        if (!isLocalOtpProvider()) {
            return c.json({ error: otpProviderDisabledMessage }, 503);
        }
        const body = await c.req.json();
        const contactNumber = asTrimmedString(body.contact_number ?? body.contactNumber ?? body.phone);
        const otp = asTrimmedString(body.otp);
        const password = asTrimmedString(body.password);
        if (!contactNumber || !otp || !password) {
            return c.json({ error: 'contact_number, otp, and password are required' }, 400);
        }
        const result = await activateDeliveryOperator({
            contact_number: contactNumber,
            otp,
            password,
        });
        return c.json(result);
    }
    catch (error) {
        console.error('POST /api/hub-staff/activate failed:', error);
        return c.json({
            error: 'Failed to activate account',
            details: process.env.NODE_ENV !== 'production' ? String(error) : undefined,
        }, 400);
    }
});
export default hubStaffRoutes;
