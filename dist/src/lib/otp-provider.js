const LOCAL_PROVIDER = 'local';
const SUPABASE_PROVIDER = 'supabase';
const normalizeOtpProvider = (value) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized === LOCAL_PROVIDER)
        return LOCAL_PROVIDER;
    if (normalized === SUPABASE_PROVIDER)
        return SUPABASE_PROVIDER;
    return undefined;
};
export const getOtpProvider = () => {
    const configured = normalizeOtpProvider(process.env.OTP_PROVIDER);
    if (configured)
        return configured;
    // Default to a fail-safe mode in production when provider is not configured.
    if (process.env.NODE_ENV === 'production') {
        return SUPABASE_PROVIDER;
    }
    return LOCAL_PROVIDER;
};
export const isLocalOtpProvider = () => getOtpProvider() === LOCAL_PROVIDER;
export const shouldExposeDevOtpCode = () => process.env.NODE_ENV !== 'production';
export const otpProviderDisabledMessage = 'OTP activation is currently disabled for this provider. Set OTP_PROVIDER=local to use temporary local OTP activation.';
