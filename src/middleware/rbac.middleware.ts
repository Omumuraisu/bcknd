export type AdminCapability =
  | 'admin:read'
  | 'admin:write'
  | 'admin:delete'
  | 'admin:ops'
  | 'admin:developer';

import type { MiddlewareHandler } from 'hono';
import { prisma } from '../lib/prisma.js';
import { AccountStatus, AdminRole, Role } from '../generated/prisma/client';
import { requireAuth } from './auth.middleware.js';

export type AdminRoleKey =
  | 'Super_Admin'
  | 'Head_Admin'
  | 'Administration_Staff'
  | 'Market_in_Charge'
  | 'Accountable_Officer';

const adminCapabilities: Record<AdminRoleKey, AdminCapability[]> = {
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
  Accountable_Officer: ['admin:read', 'admin:ops'],
};

export const hasAdminCapability = (
  adminRole: string | null | undefined,
  capability: AdminCapability
) => {
  if (!adminRole || !(adminRole in adminCapabilities)) return false;
  const roleKey = adminRole as AdminRoleKey;
  return adminCapabilities[roleKey].includes(capability);
};

const creatableRolesByCreator: Record<AdminRoleKey, AdminRole[]> = {
  Super_Admin: [
    AdminRole.Head_Admin,
    AdminRole.Administration_Staff,
    AdminRole.Market_in_Charge,
    AdminRole.Accountable_Officer,
  ],
  Head_Admin: [
    AdminRole.Administration_Staff,
    AdminRole.Market_in_Charge,
    AdminRole.Accountable_Officer,
  ],
  Administration_Staff: [AdminRole.Market_in_Charge, AdminRole.Accountable_Officer],
  Market_in_Charge: [],
  Accountable_Officer: [],
};

export const canCreateAdminRole = (
  creatorRole: string | null | undefined,
  targetRole: AdminRole
) => {
  if (!creatorRole || !(creatorRole in creatableRolesByCreator)) return false;
  const roleKey = creatorRole as AdminRoleKey;
  return creatableRolesByCreator[roleKey].includes(targetRole);
};

export const requireAdminCapability = (
  capability: AdminCapability
): MiddlewareHandler => {
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

