import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase auth is not fully configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.'
  );
}

export const supabaseAuthClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export const supabaseAdminClient =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export type SupabaseVerifiedUser = {
  id: string;
  email: string | null;
  phone: string | null;
};

type SignInWithPasswordResult = {
  ok: boolean;
  error?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: SupabaseVerifiedUser;
};

export const verifySupabaseAccessToken = async (
  accessToken: string
): Promise<SupabaseVerifiedUser | null> => {
  if (!supabaseAuthClient || !accessToken) return null;

  const { data, error } = await supabaseAuthClient.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
  };
};

export const signInSupabaseWithEmailPassword = async (
  email: string,
  password: string
): Promise<SignInWithPasswordResult> => {
  if (!supabaseAuthClient) {
    return {
      ok: false,
      error: 'Supabase auth client is not configured',
    };
  }

  const { data, error } = await supabaseAuthClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session || !data.user) {
    return {
      ok: false,
      error: error?.message ?? 'Invalid credentials',
    };
  }

  return {
    ok: true,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      phone: data.user.phone ?? null,
    },
  };
};

export const sendSupabaseEmailOtp = async (email: string) => {
  if (!supabaseAuthClient) {
    throw new Error('Supabase auth client is not configured');
  }

  const { error } = await supabaseAuthClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to send OTP');
  }
};

export const verifySupabaseEmailOtp = async (email: string, token: string) => {
  if (!supabaseAuthClient) {
    throw new Error('Supabase auth client is not configured');
  }

  const { data, error } = await supabaseAuthClient.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });

  if (error || !data.user) {
    throw new Error(error?.message || 'Invalid or expired OTP');
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
  } satisfies SupabaseVerifiedUser;
};
