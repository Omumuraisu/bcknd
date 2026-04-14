import { prisma } from '../lib/prisma.js';
import { AccountStatus, Role } from '../generated/prisma/client';
import { requireAuth } from './auth.middleware.js';
const adminCapabilities = {
    Super_Admin: [
        'admin:read',
        'admin:write',
        'admin:delete',
        'admin:ops',
        'admin:developer',
    ],
    Head_Admin: ['admin:read', 'admin:write', 'admin:delete', 'admin:ops'],
    Administration_Staff: ['admin:read', 'admin:write'],
    Market_in_Charge: ['admin:read', 'admin:ops'],
};
export const hasAdminCapability = (adminRole, capability) => {
    if (!adminRole || !(adminRole in adminCapabilities))
        return false;
    const roleKey = adminRole;
    return adminCapabilities[roleKey].includes(capability);
};
export const requireAdminCapability = (capability) => {
    return async (c, next) => {
        let nextCalled = false;
        const authResponse = await requireAuth(c, async () => {
            nextCalled = true;
        });
        if (!nextCalled) {
            return authResponse;
        }
        const auth = c.get('auth');
        if (auth.role !== Role.Admin) {
            return c.json({ error: 'Admin role required' }, 403);
        }
        const admin = await prisma.leeo_admin.findUnique({
            where: { account_id: auth.accountId },
            select: {
                admin_role: true,
                account_status: true,
            },
        });
        if (!admin) {
            return c.json({ error: 'Admin profile not found' }, 403);
        }
        if (admin.account_status !== AccountStatus.Active) {
            return c.json({ error: 'Admin account is not active' }, 403);
        }
        c.set('adminRole', admin.admin_role);
        if (!hasAdminCapability(admin.admin_role, capability)) {
            return c.json({ error: 'Insufficient admin permissions' }, 403);
        }
        await next();
    };
};
