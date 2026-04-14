import { AccountStatus, AdminRole, Role } from '../generated/prisma/client';
import { prisma } from '../lib/prisma.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FrontendAdminRole = 'head_admin' | 'admin' | 'market_in_charge';

type AdminIdentityDTO = {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  role: FrontendAdminRole;
  avatar_url: string;
};

type AdminProfileDTO = {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  role: FrontendAdminRole;
  profile_image: string;
  avatar_url: string;
};

type PersonnelDTO = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: FrontendAdminRole;
};

type PersonnelInput = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

const toFrontendRole = (value: AdminRole): FrontendAdminRole => {
  if (value === AdminRole.Head_Admin) return 'head_admin';
  if (value === AdminRole.Market_in_Charge) return 'market_in_charge';
  return 'admin';
};

const toAdminRole = (value: string): AdminRole => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'head_admin') return AdminRole.Head_Admin;
  if (normalized === 'admin') return AdminRole.Administration_Staff;
  if (normalized === 'market_in_charge') return AdminRole.Market_in_Charge;
  throw new Error('Invalid role. Allowed values: head_admin, admin, market_in_charge');
};

const assertValidEmail = (email: string) => {
  if (!emailPattern.test(email.trim())) {
    throw new Error('Invalid email format');
  }
};

const asSafeNumber = (value: bigint): number => Number(value);

const placeholderPhone = (email: string) => {
  const stamp = Date.now();
  const nonce = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  const compactEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);
  return `admin-${compactEmail}-${stamp}-${nonce}`;
};

const selectAdminWithAccount = {
  admin_id: true,
  account_id: true,
  first_name: true,
  last_name: true,
  admin_role: true,
  account_status: true,
  account: {
    select: {
      email: true,
      role: true,
      account_status: true,
    },
  },
} as const;

const toIdentityDTO = (admin: {
  account_id: bigint;
  first_name: string;
  last_name: string;
  admin_role: AdminRole;
  account: { email: string };
}): AdminIdentityDTO => ({
  id: asSafeNumber(admin.account_id),
  first_name: admin.first_name,
  last_name: admin.last_name,
  full_name: `${admin.first_name} ${admin.last_name}`.trim(),
  email: admin.account.email,
  role: toFrontendRole(admin.admin_role),
  avatar_url: '',
});

const toProfileDTO = (admin: {
  first_name: string;
  last_name: string;
  admin_role: AdminRole;
  account: { email: string };
}): AdminProfileDTO => ({
  first_name: admin.first_name,
  last_name: admin.last_name,
  full_name: `${admin.first_name} ${admin.last_name}`.trim(),
  email: admin.account.email,
  role: toFrontendRole(admin.admin_role),
  profile_image: '',
  avatar_url: '',
});

const toPersonnelDTO = (admin: {
  account_id: bigint;
  first_name: string;
  last_name: string;
  admin_role: AdminRole;
  account: { email: string };
}): PersonnelDTO => ({
  id: asSafeNumber(admin.account_id),
  first_name: admin.first_name,
  last_name: admin.last_name,
  email: admin.account.email,
  role: toFrontendRole(admin.admin_role),
});

const getAdminByAccountId = async (accountId: bigint) => {
  return prisma.leeo_admin.findUnique({
    where: { account_id: accountId },
    select: selectAdminWithAccount,
  });
};

const normalizePersonnelInput = (input: PersonnelInput) => {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();

  const missing: string[] = [];
  if (!firstName) missing.push('firstName');
  if (!lastName) missing.push('lastName');
  if (!email) missing.push('email');
  if (!input.role?.trim()) missing.push('role');

  if (missing.length > 0) {
    const error = new Error('Missing required fields');
    (error as Error & { fields?: string[] }).fields = missing;
    throw error;
  }

  assertValidEmail(email);

  return {
    firstName,
    lastName,
    email,
    adminRole: toAdminRole(input.role),
  };
};

export const getCurrentAdminIdentity = async (accountId: bigint) => {
  const admin = await getAdminByAccountId(accountId);
  if (!admin) throw new Error('Admin profile not found');
  return toIdentityDTO(admin);
};

export const getCurrentAdminProfile = async (accountId: bigint) => {
  const admin = await getAdminByAccountId(accountId);
  if (!admin) throw new Error('Admin profile not found');
  return toProfileDTO(admin);
};

export const updateCurrentAdminProfile = async (
  accountId: bigint,
  input: PersonnelInput
) => {
  const normalized = normalizePersonnelInput(input);

  const updated = await prisma.$transaction(async tx => {
    await tx.account.update({
      where: { account_id: accountId },
      data: {
        email: normalized.email,
      },
    });

    return tx.leeo_admin.update({
      where: { account_id: accountId },
      data: {
        first_name: normalized.firstName,
        last_name: normalized.lastName,
        admin_role: normalized.adminRole,
      },
      select: selectAdminWithAccount,
    });
  });

  return toProfileDTO(updated);
};

export const listPersonnel = async () => {
  const admins = await prisma.leeo_admin.findMany({
    where: {
      account: {
        role: Role.Admin,
      },
    },
    orderBy: { admin_id: 'asc' },
    select: selectAdminWithAccount,
  });

  return admins.map(toPersonnelDTO);
};

export const createPersonnel = async (input: PersonnelInput) => {
  const normalized = normalizePersonnelInput(input);
  const createdAt = new Date();

  const account = await prisma.account.create({
    data: {
      phone: placeholderPhone(normalized.email),
      email: normalized.email,
      password: null,
      role: Role.Admin,
      created_at: createdAt,
      account_status: AccountStatus.Active,
      email_verified_at: createdAt,
      leeoAdmin: {
        create: {
          first_name: normalized.firstName,
          last_name: normalized.lastName,
          admin_role: normalized.adminRole,
          contact_number: placeholderPhone(normalized.email),
          account_status: AccountStatus.Active,
          created_at: createdAt,
        },
      },
    },
    select: {
      account_id: true,
      leeoAdmin: {
        select: {
          first_name: true,
          last_name: true,
          admin_role: true,
        },
      },
      email: true,
    },
  });

  if (!account.leeoAdmin) {
    throw new Error('Failed to create admin personnel');
  }

  return {
    id: asSafeNumber(account.account_id),
    first_name: account.leeoAdmin.first_name,
    last_name: account.leeoAdmin.last_name,
    email: account.email,
    role: toFrontendRole(account.leeoAdmin.admin_role),
  } satisfies PersonnelDTO;
};

export const updatePersonnel = async (accountId: bigint, input: PersonnelInput) => {
  const normalized = normalizePersonnelInput(input);

  const updated = await prisma.$transaction(async tx => {
    await tx.account.update({
      where: { account_id: accountId },
      data: {
        email: normalized.email,
      },
    });

    return tx.leeo_admin.update({
      where: { account_id: accountId },
      data: {
        first_name: normalized.firstName,
        last_name: normalized.lastName,
        admin_role: normalized.adminRole,
      },
      select: selectAdminWithAccount,
    });
  });

  return toPersonnelDTO(updated);
};

export const deletePersonnel = async (accountId: bigint) => {
  await prisma.$transaction(async tx => {
    await tx.leeo_admin.delete({
      where: { account_id: accountId },
    });

    await tx.account.delete({
      where: { account_id: accountId },
    });
  });
};