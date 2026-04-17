import { AccountStatus, Role } from '../generated/prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  getLocalAccessTokenExpiresInSeconds,
  signLocalAccessToken,
  verifyLocalRefreshToken,
} from '../lib/local-auth.js';
import {
  sendSupabaseEmailOtp,
  signInSupabaseWithEmailPassword,
  supabaseAdminClient,
  verifySupabaseEmailOtp,
} from '../lib/supabase-auth.js';

const MIN_PASSWORD_LENGTH = 8;

const normalizeIdentifier = (identifier: string) => identifier.trim();

type AuthProfileRow = {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  is_active: boolean;
  role: string | null;
};

const validatePasswordPolicy = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
};

const asBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return fallback;
};

const findProfileByIdentifier = async (identifier: string): Promise<AuthProfileRow | null> => {
  const normalized = normalizeIdentifier(identifier);

  const rows = (await prisma.$queryRawUnsafe(
    `
      select
        ap.id,
        ap.email,
        ap.phone,
        coalesce(
          nullif(to_jsonb(ap)->>'username', ''),
          ap.raw_user_meta_data->>'username'
        ) as username,
        coalesce(
          (to_jsonb(ap)->>'is_active')::boolean,
          (ap.raw_user_meta_data->>'is_active')::boolean,
          true
        ) as is_active,
        coalesce(
          nullif(to_jsonb(ap)->>'role', ''),
          ap.raw_user_meta_data->>'role'
        ) as role
      from public.auth_profiles ap
      where
        lower(coalesce(nullif(to_jsonb(ap)->>'username', ''), ap.raw_user_meta_data->>'username', '')) = lower($1)
        or lower(coalesce(ap.email, '')) = lower($1)
        or coalesce(ap.phone, '') = $1
      limit 1
    `,
    normalized
  )) as Array<{
    id: string;
    email: string | null;
    phone: string | null;
    username: string | null;
    is_active: boolean | string | null;
    role: string | null;
  }>;

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    username: row.username,
    is_active: asBoolean(row.is_active, true),
    role: row.role,
  };
};

const findAccountForProfile = async (profile: AuthProfileRow) => {
  const orConditions: Array<{ supabase_user_id?: string; email?: string; phone?: string }> = [
    { supabase_user_id: profile.id },
  ];

  if (profile.email) {
    orConditions.push({ email: profile.email });
  }

  if (profile.phone) {
    orConditions.push({ phone: profile.phone });
  }

  return prisma.account.findFirst({
    where: {
      OR: orConditions,
    },
    select: {
      account_id: true,
      email: true,
      phone: true,
      role: true,
      account_status: true,
    },
  });
};

const markProfileAsActive = async (profileId: string) => {
  await prisma.$executeRawUnsafe(
    `
      update public.auth_profiles
      set raw_user_meta_data = jsonb_set(
            coalesce(raw_user_meta_data, '{}'::jsonb),
            '{is_active}',
            'true'::jsonb,
            true
          ),
          updated_at = timezone('utc', now())
      where id = $1
    `,
    profileId
  );

  await prisma.account.updateMany({
    where: { supabase_user_id: profileId },
    data: {
      account_status: AccountStatus.Active,
      email_verified_at: new Date(),
    },
  });
};

export const requestEmailVerificationCode = async (identifier: string) => {
  const profile = await findProfileByIdentifier(identifier);

  if (!profile || !profile.email) {
    throw new Error('Account not found');
  }

  if (profile.is_active) {
    return {
      message: 'Account is already active',
      alreadyActive: true,
    };
  }

  await sendSupabaseEmailOtp(profile.email);

  return {
    message: 'Activation code sent',
  };
};

export const verifyEmailCode = async (identifier: string, code: string) => {
  const profile = await findProfileByIdentifier(identifier);

  if (!profile || !profile.email) {
    throw new Error('Account not found');
  }

  await verifySupabaseEmailOtp(profile.email, code);
  await markProfileAsActive(profile.id);

  return {
    message: 'Account activated successfully',
  };
};

export const loginWithPassword = async (identifier: string, password: string) => {
  const profile = await findProfileByIdentifier(identifier);

  if (!profile || !profile.email) {
    throw new Error('Invalid credentials');
  }

  if (!profile.is_active) {
    return {
      ok: false as const,
      status: 403 as const,
      body: {
        error: 'Account activation required',
        needsActivation: true,
      },
    };
  }

  const signInResult = await signInSupabaseWithEmailPassword(profile.email, password);
  if (!signInResult.ok || !signInResult.accessToken) {
    throw new Error('Invalid credentials');
  }

  const account = await findAccountForProfile(profile);

  if (!account) {
    return {
      ok: false as const,
      status: 403 as const,
      body: {
        error: 'Account mapping not found',
      },
    };
  }

  if (account.account_status !== AccountStatus.Active) {
    return {
      ok: false as const,
      status: 403 as const,
      body: {
        error: 'Account is not active',
      },
    };
  }

  return {
    ok: true as const,
    status: 200 as const,
    body: {
      accessToken: signInResult.accessToken,
      refreshToken: signInResult.refreshToken,
      tokenType: 'Bearer',
      expiresIn: getLocalAccessTokenExpiresInSeconds(),
      account: {
        accountId: account.account_id.toString(),
        role: account.role,
        email: account.email,
        phone: account.phone,
        username: profile.username,
      },
    },
  };
};

export const requestAdminPasswordSetupCode = async (identifier: string) => {
  const profile = await findProfileByIdentifier(identifier);

  if (!profile || !profile.email) {
    throw new Error('Account not found');
  }

  const account = await findAccountForProfile(profile);

  if (!account) {
    throw new Error('Account not found');
  }

  if (!isAdminRole(account.role)) {
    throw new Error('Admin account required');
  }

  if (account.account_status === AccountStatus.Disabled) {
    throw new Error('Admin account is disabled');
  }

  if (profile.is_active) {
    return {
      message: 'Account is already active',
      alreadyActive: true,
    };
  }

  await sendSupabaseEmailOtp(profile.email);
  return {
    message: 'Activation code sent',
  };
};

export const createAdminPassword = async (
  identifier: string,
  verificationCode: string,
  newPassword: string
) => {
  const profile = await findProfileByIdentifier(identifier);

  if (!profile || !profile.email) {
    throw new Error('Account not found');
  }

  const account = await findAccountForProfile(profile);

  if (!account) {
    throw new Error('Account not found');
  }

  if (!isAdminRole(account.role)) {
    throw new Error('Admin account required');
  }

  if (account.account_status === AccountStatus.Disabled) {
    throw new Error('Admin account is disabled');
  }

  validatePasswordPolicy(newPassword);
  await verifySupabaseEmailOtp(profile.email, verificationCode);

  if (!supabaseAdminClient) {
    throw new Error('Supabase admin client is not configured');
  }

  const { error } = await supabaseAdminClient.auth.admin.updateUserById(profile.id, {
    password: newPassword,
  });

  if (error) {
    throw new Error(error.message || 'Failed to set password');
  }

  await markProfileAsActive(profile.id);

  return {
    message: 'Admin account activated successfully',
  };
};

export const isAdminRole = (role: Role) => role === Role.Admin;

export const refreshDeliveryOperatorAccessToken = async (refreshToken: string) => {
  const verified = verifyLocalRefreshToken(refreshToken);

  if (!verified) {
    return {
      ok: false as const,
      status: 401 as const,
      body: {
        error: 'Invalid or expired refresh token',
      },
    };
  }

  const account = await prisma.account.findUnique({
    where: { account_id: BigInt(verified.sub) },
    select: {
      account_id: true,
      role: true,
      account_status: true,
    },
  });

  if (!account) {
    return {
      ok: false as const,
      status: 401 as const,
      body: {
        error: 'Refresh token account not found',
      },
    };
  }

  if (account.role !== Role.Delivery_Operator) {
    return {
      ok: false as const,
      status: 403 as const,
      body: {
        error: 'Delivery operator account required',
      },
    };
  }

  if (account.account_status !== AccountStatus.Active) {
    return {
      ok: false as const,
      status: 403 as const,
      body: {
        error: 'Account is not active',
      },
    };
  }

  const accessToken = signLocalAccessToken({
    accountId: account.account_id,
    role: account.role,
  });

  return {
    ok: true as const,
    status: 200 as const,
    body: {
      accessToken,
      expiresIn: getLocalAccessTokenExpiresInSeconds(),
    },
  };
};