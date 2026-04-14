import { AccountStatus, AdminRole, Role } from '../generated/prisma/client';
import { prisma } from '../lib/prisma.js';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const toFrontendRole = (value) => {
    if (value === AdminRole.Super_Admin)
        return 'super_admin';
    if (value === AdminRole.Head_Admin)
        return 'head_admin';
    if (value === AdminRole.Accountable_Officer)
        return 'accountable_officer';
    if (value === AdminRole.Market_in_Charge)
        return 'market_in_charge';
    return 'admin';
};
export const normalizeIncomingAdminRole = (value) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'super_admin' || normalized === 'super admin' || normalized === 'sa') {
        return AdminRole.Super_Admin;
    }
    if (normalized === 'head_admin' ||
        normalized === 'head admin' ||
        normalized === 'head dept' ||
        normalized === 'hd') {
        return AdminRole.Head_Admin;
    }
    if (normalized === 'admin' ||
        normalized === 'admin staff' ||
        normalized === 'administration_staff' ||
        normalized === 'administration staff' ||
        normalized === 'as') {
        return AdminRole.Administration_Staff;
    }
    if (normalized === 'market_in_charge' ||
        normalized === 'market in charge' ||
        normalized === 'market-in-charge' ||
        normalized === 'mic' ||
        normalized === 'accountable officer' ||
        normalized === 'ao') {
        return AdminRole.Market_in_Charge;
    }
    if (normalized === 'accountable_officer' ||
        normalized === 'accountable officer' ||
        normalized === 'ao') {
        return AdminRole.Accountable_Officer;
    }
    throw new Error('Invalid role. Allowed values: super_admin, head_admin, admin, market_in_charge, accountable_officer');
};
const toAdminRole = (value) => normalizeIncomingAdminRole(value);
const assertValidEmail = (email) => {
    if (!emailPattern.test(email.trim())) {
        throw new Error('Invalid email format');
    }
};
const asSafeNumber = (value) => Number(value);
const normalizeProfileImageUrl = (value) => {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};
const placeholderPhone = (email) => {
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
            supabase_user_id: true,
        },
    },
};
const toIdentityDTO = (admin) => ({
    id: asSafeNumber(admin.account_id),
    first_name: admin.first_name,
    last_name: admin.last_name,
    full_name: `${admin.first_name} ${admin.last_name}`.trim(),
    email: admin.account.email,
    role: toFrontendRole(admin.admin_role),
    avatar_url: '',
});
const toProfileDTO = (admin, profileImage) => ({
    first_name: admin.first_name,
    last_name: admin.last_name,
    full_name: `${admin.first_name} ${admin.last_name}`.trim(),
    email: admin.account.email,
    role: toFrontendRole(admin.admin_role),
    profile_image: profileImage,
    avatar_url: profileImage,
});
const getProfileImageFromAuthProfile = async (supabaseUserId) => {
    if (!supabaseUserId)
        return '';
    const rows = (await prisma.$queryRawUnsafe(`
      select coalesce(
        nullif(raw_user_meta_data->>'profileImageUrl', ''),
        nullif(raw_user_meta_data->>'profile_image', ''),
        nullif(raw_user_meta_data->>'avatar_url', ''),
        ''
      ) as profile_image
      from public.auth_profiles
      where id = $1
      limit 1
    `, supabaseUserId));
    return rows[0]?.profile_image ?? '';
};
const saveProfileImageToAuthProfile = async (supabaseUserId, profileImageUrl) => {
    await prisma.$executeRawUnsafe(`
      update public.auth_profiles
      set raw_user_meta_data =
        case
          when nullif($2, '') is null then
            (coalesce(raw_user_meta_data, '{}'::jsonb) - 'profileImageUrl' - 'profile_image' - 'avatar_url')
          else
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  coalesce(raw_user_meta_data, '{}'::jsonb),
                  '{profileImageUrl}',
                  to_jsonb($2::text),
                  true
                ),
                '{profile_image}',
                to_jsonb($2::text),
                true
              ),
              '{avatar_url}',
              to_jsonb($2::text),
              true
            )
        end,
        updated_at = timezone('utc', now())
      where id = $1
    `, supabaseUserId, profileImageUrl);
};
const toPersonnelDTO = (admin) => ({
    id: asSafeNumber(admin.account_id),
    first_name: admin.first_name,
    last_name: admin.last_name,
    email: admin.account.email,
    role: toFrontendRole(admin.admin_role),
});
const getAdminByAccountId = async (accountId) => {
    return prisma.leeo_admin.findUnique({
        where: { account_id: accountId },
        select: selectAdminWithAccount,
    });
};
const normalizePersonnelInput = (input) => {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const email = input.email.trim().toLowerCase();
    const missing = [];
    if (!firstName)
        missing.push('firstName');
    if (!lastName)
        missing.push('lastName');
    if (!email)
        missing.push('email');
    if (!input.role?.trim())
        missing.push('role');
    if (missing.length > 0) {
        const error = new Error('Missing required fields');
        error.fields = missing;
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
export const getCurrentAdminIdentity = async (accountId) => {
    const admin = await getAdminByAccountId(accountId);
    if (!admin)
        throw new Error('Admin profile not found');
    return toIdentityDTO(admin);
};
export const getCurrentAdminProfile = async (accountId) => {
    const admin = await getAdminByAccountId(accountId);
    if (!admin)
        throw new Error('Admin profile not found');
    const profileImage = await getProfileImageFromAuthProfile(admin.account.supabase_user_id);
    return toProfileDTO(admin, profileImage);
};
export const updateCurrentAdminProfile = async (accountId, input) => {
    const normalized = normalizePersonnelInput(input);
    const normalizedProfileImage = normalizeProfileImageUrl(input.profileImageUrl);
    const updated = await prisma.$transaction(async (tx) => {
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
    if (updated.account.supabase_user_id) {
        await saveProfileImageToAuthProfile(updated.account.supabase_user_id, normalizedProfileImage);
    }
    const profileImage = await getProfileImageFromAuthProfile(updated.account.supabase_user_id);
    return toProfileDTO(updated, profileImage);
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
export const createPersonnel = async (input) => {
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
    };
};
export const updatePersonnel = async (accountId, input) => {
    const normalized = normalizePersonnelInput(input);
    const updated = await prisma.$transaction(async (tx) => {
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
export const deletePersonnel = async (accountId) => {
    await prisma.$transaction(async (tx) => {
        await tx.account_activation_otp.deleteMany({
            where: { account_id: accountId },
        });
        await tx.account_email_verification_otp.deleteMany({
            where: { account_id: accountId },
        });
        await tx.leeo_admin.delete({
            where: { account_id: accountId },
        });
        await tx.account.delete({
            where: { account_id: accountId },
        });
    });
};
