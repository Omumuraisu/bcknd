export type OtpProvider = 'local' | 'supabase';

const LOCAL_PROVIDER: OtpProvider = 'local';
const SUPABASE_PROVIDER: OtpProvider = 'supabase';

const normalizeOtpProvider = (value: string | undefined): OtpProvider | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === LOCAL_PROVIDER) return LOCAL_PROVIDER;
  if (normalized === SUPABASE_PROVIDER) return SUPABASE_PROVIDER;
  return undefined;
};

export const getOtpProvider = (): OtpProvider => {
  const configured = normalizeOtpProvider(process.env.OTP_PROVIDER);
  if (configured) return configured;

  // Default to a fail-safe mode in production when provider is not configured.
  if (process.env.NODE_ENV === 'production') {
    return SUPABASE_PROVIDER;
  }

  return LOCAL_PROVIDER;
};

export const isLocalOtpProvider = (): boolean => getOtpProvider() === LOCAL_PROVIDER;

export const shouldExposeDevOtpCode = (): boolean => process.env.NODE_ENV !== 'production';

export const otpProviderDisabledMessage =
  'OTP activation is currently disabled for this provider. Set OTP_PROVIDER=local to use temporary local OTP activation.';