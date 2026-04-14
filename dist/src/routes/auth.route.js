import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Role } from '../generated/prisma/client.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireAdminCapability } from '../middleware/rbac.middleware.js';
import { getDeliveryOperatorSelfProfile } from '../services/admin-services/delivery-op.service.js';
import { getCurrentAdminIdentity } from '../services/admin-settings.service.js';
import { createAdminPassword, loginWithPassword, requestAdminPasswordSetupCode, requestEmailVerificationCode, verifyEmailCode, } from '../services/auth.service.js';
const authRoutes = new Hono();
authRoutes.use('*', cors({
    origin: process.env.ADMIN_FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));
const asTrimmedString = (value) => {
    if (typeof value !== 'string')
        return '';
    return value.trim();
};
const isDevelopment = process.env.NODE_ENV !== 'production';
authRoutes.get('/me', requireAuth, async (c) => {
    try {
        const auth = c.get('auth');
        if (auth.role === Role.Admin) {
            const account = await getCurrentAdminIdentity(auth.accountId);
            return c.json({ account }, 200);
        }
        if (auth.role === Role.Delivery_Operator) {
            const profile = await getDeliveryOperatorSelfProfile(auth.accountId);
            const account = {
                account_id: profile.accountId,
                accountId: profile.accountId,
                email: profile.email,
                phone: profile.phone,
                contact_number: profile.contact_number,
                role: profile.role,
            };
            const hubStaff = {
                first_name: profile.first_name,
                firstName: profile.firstName,
                last_name: profile.last_name,
                lastName: profile.lastName,
                contact_number: profile.contact_number,
            };
            return c.json({
                account,
                hubStaff,
                data: {
                    account,
                    hubStaff,
                },
            }, 200);
        }
        return c.json({ error: 'Forbidden for current role' }, 403);
    }
    catch (error) {
        return c.json({
            error: 'Failed to load authenticated account',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, 400);
    }
});
authRoutes.post('/login', async (c) => {
    try {
        const body = (await c.req.json());
        const identifier = asTrimmedString(body.identifier ?? body.email ?? body.phone ?? body.username);
        const password = asTrimmedString(body.password);
        if (!identifier || !password) {
            return c.json({ error: 'identifier and password are required' }, 400);
        }
        const result = await loginWithPassword(identifier, password);
        if (!result.ok) {
            return c.json(result.body, result.status);
        }
        return c.json(result.body, result.status);
    }
    catch (error) {
        const isInvalidCredentials = String(error).includes('Invalid credentials');
        return c.json({
            error: isInvalidCredentials ? 'Invalid credentials' : 'Login failed',
            ...(isDevelopment && !isInvalidCredentials ? { details: String(error) } : {}),
        }, isInvalidCredentials ? 401 : 500);
    }
});
authRoutes.post('/request-email-verification', async (c) => {
    try {
        const body = (await c.req.json());
        const identifier = asTrimmedString(body.identifier ?? body.email ?? body.phone ?? body.username);
        if (!identifier) {
            return c.json({ error: 'identifier is required' }, 400);
        }
        const result = await requestEmailVerificationCode(identifier);
        return c.json(result);
    }
    catch (error) {
        return c.json({
            error: 'Failed to request verification code',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, 400);
    }
});
authRoutes.post('/verify-email', async (c) => {
    try {
        const body = (await c.req.json());
        const identifier = asTrimmedString(body.identifier ?? body.email ?? body.phone ?? body.username);
        const verificationCode = asTrimmedString(body.verificationCode ?? body.code);
        if (!identifier || !verificationCode) {
            return c.json({ error: 'identifier and verificationCode are required' }, 400);
        }
        const result = await verifyEmailCode(identifier, verificationCode);
        return c.json(result);
    }
    catch (error) {
        return c.json({
            error: 'Failed to verify email',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, 400);
    }
});
authRoutes.post('/admin/request-password-setup', async (c) => {
    try {
        const body = (await c.req.json());
        const identifier = asTrimmedString(body.identifier ?? body.email ?? body.phone ?? body.username);
        if (!identifier) {
            return c.json({ error: 'identifier is required' }, 400);
        }
        const result = await requestAdminPasswordSetupCode(identifier);
        return c.json(result);
    }
    catch (error) {
        const message = String(error);
        const isNotFound = message.includes('Account not found');
        const isForbidden = message.includes('Admin account required') ||
            message.includes('Admin account is disabled');
        return c.json({
            error: isNotFound
                ? 'Account not found'
                : isForbidden
                    ? 'This account is not allowed to use admin password setup'
                    : 'Failed to request admin password setup code',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, isNotFound ? 404 : isForbidden ? 403 : 400);
    }
});
authRoutes.post('/admin/create-password', async (c) => {
    try {
        const body = (await c.req.json());
        const identifier = asTrimmedString(body.identifier ?? body.email ?? body.phone ?? body.username);
        const verificationCode = asTrimmedString(body.verificationCode ?? body.code);
        const newPassword = asTrimmedString(body.newPassword ?? body.password);
        if (!identifier || !verificationCode || !newPassword) {
            return c.json({ error: 'identifier, verificationCode, and newPassword are required' }, 400);
        }
        const result = await createAdminPassword(identifier, verificationCode, newPassword);
        return c.json(result);
    }
    catch (error) {
        const message = String(error);
        const isNotFound = message.includes('Account not found');
        const isForbidden = message.includes('Admin account required') ||
            message.includes('Admin account is disabled');
        const isPolicyError = message.includes('Password must be at least 8 characters long');
        return c.json({
            error: isNotFound
                ? 'Account not found'
                : isForbidden
                    ? 'This account is not allowed to create admin password'
                    : isPolicyError
                        ? 'Password must be at least 8 characters long'
                        : 'Failed to create admin password',
            ...(isDevelopment ? { details: String(error) } : {}),
        }, isNotFound ? 404 : isForbidden ? 403 : 400);
    }
});
export default authRoutes;
