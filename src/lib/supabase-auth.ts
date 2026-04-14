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
