import bcrypt from 'bcrypt';
import { AccountStatus, Role } from '../generated/prisma/client';
import { prisma } from '../lib/prisma.js';
import { getLocalAccessTokenExpiresIn, getLocalAccessTokenExpiresInSeconds, signLocalAccessToken, signLocalRefreshToken, verifyLocalRefreshToken, } from '../lib/local-auth.js';
const PASSWORD_SALT_ROUNDS = 10;
const OTP_SALT_ROUNDS = 8;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const normalizeIdentifier = (identifier) => identifier.trim();
const shouldExposeDevCode = () => process.env.NODE_ENV !== 'production';
const generateOtpCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};
const validatePasswordPolicy = (password) => {
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
    }
};
const findAccountByIdentifier = async (identifier) => {
    const normalized = normalizeIdentifier(identifier);
    return prisma.account.findFirst({
        where: {
            OR: [{ email: normalized }, { phone: normalized }],
        },
        select: {
            account_id: true,
            email: true,
            phone: true,
            password: true,
            role: true,
            account_status: true,
            email_verified_at: true,
        },
    });
};
const consumeEmailVerificationCode = async (accountId, code) => {
    const otpRecord = await prisma.account_email_verification_otp.findFirst({
        where: {
            account_id: accountId,
            consumed_at: null,
            expires_at: {
                gt: new Date(),
            },
        },
        orderBy: {
            created_at: 'desc',
        },
    });
    if (!otpRecord) {
        throw new Error('No valid verification code found. Request a new one.');
    }
    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
        await prisma.account_email_verification_otp.update({
            where: { otp_id: otpRecord.otp_id },
            data: {
                consumed_at: new Date(),
            },
        });
        throw new Error('Verification attempts exceeded. Request a new code.');
    }
    const isCodeValid = await bcrypt.compare(code, otpRecord.code_hash);
    if (!isCodeValid) {
        await prisma.account_email_verification_otp.update({
            where: { otp_id: otpRecord.otp_id },
            data: {
                attempts: otpRecord.attempts + 1,
            },
        });
        throw new Error('Invalid verification code');
    }
    await prisma.account_email_verification_otp.updateMany({
        where: {
            account_id: accountId,
            consumed_at: null,
        },
        data: {
            consumed_at: new Date(),
        },
    });
};
export const requestEmailVerificationCode = async (identifier) => {
    const account = await findAccountByIdentifier(identifier);
    if (!account) {
        throw new Error('Account not found');
    }
    if (account.account_status !== AccountStatus.Active) {
        throw new Error('Account is not active');
    }
    await prisma.account_email_verification_otp.updateMany({
        where: {
            account_id: account.account_id,
            consumed_at: null,
        },
        data: {
            consumed_at: new Date(),
        },
    });
    const otpCode = generateOtpCode();
    const codeHash = await bcrypt.hash(otpCode, OTP_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await prisma.account_email_verification_otp.create({
        data: {
            account_id: account.account_id,
            code_hash: codeHash,
            expires_at: expiresAt,
            created_at: new Date(),
        },
    });
    return {
        message: 'Email verification code generated',
        expiresAt,
        ...(shouldExposeDevCode() ? { verificationCode: otpCode } : {}),
    };
};
export const verifyEmailCode = async (identifier, code) => {
    const account = await findAccountByIdentifier(identifier);
    if (!account) {
        throw new Error('Account not found');
    }
    await consumeEmailVerificationCode(account.account_id, code);
    await prisma.$transaction([
        prisma.account.update({
            where: {
                account_id: account.account_id,
            },
            data: {
                email_verified_at: new Date(),
            },
        }),
    ]);
    return {
        message: 'Email verified successfully',
    };
};
export const loginWithPassword = async (identifier, password) => {
    const account = await findAccountByIdentifier(identifier);
    if (!account || !account.password) {
        throw new Error('Invalid credentials');
    }
    const isPasswordValid = await bcrypt.compare(password, account.password);
    if (!isPasswordValid) {
        throw new Error('Invalid credentials');
    }
    if (account.account_status !== AccountStatus.Active) {
        return {
            ok: false,
            status: 403,
            body: {
                error: 'Account is not active',
            },
        };
    }
    if (!account.email_verified_at) {
        return {
            ok: false,
            status: 403,
            body: {
                error: 'Email is not verified',
                needsEmailVerification: true,
            },
        };
    }
    const accessToken = signLocalAccessToken({
        accountId: account.account_id,
        role: account.role,
    });
    const refreshToken = signLocalRefreshToken({
        accountId: account.account_id,
        role: account.role,
    });
    return {
        ok: true,
        status: 200,
        body: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: getLocalAccessTokenExpiresInSeconds(),
            account: {
                accountId: account.account_id.toString(),
                role: account.role,
                email: account.email,
                phone: account.phone,
            },
        },
    };
};
export const requestAdminPasswordSetupCode = async (identifier) => {
    const account = await findAccountByIdentifier(identifier);
    if (!account) {
        throw new Error('Account not found');
    }
    if (!isAdminRole(account.role)) {
        throw new Error('Admin account required');
    }
    if (account.account_status === AccountStatus.Disabled) {
        throw new Error('Admin account is disabled');
    }
    return requestEmailVerificationCode(identifier);
};
export const createAdminPassword = async (identifier, verificationCode, newPassword) => {
    const account = await findAccountByIdentifier(identifier);
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
    await consumeEmailVerificationCode(account.account_id, verificationCode);
    const hashedPassword = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await prisma.account.update({
        where: {
            account_id: account.account_id,
        },
        data: {
            password: hashedPassword,
            email_verified_at: new Date(),
            account_status: AccountStatus.Active,
        },
    });
    return {
        message: 'Admin password created successfully',
    };
};
export const isAdminRole = (role) => role === Role.Admin;
export const refreshDeliveryOperatorAccessToken = async (refreshToken) => {
    const verified = verifyLocalRefreshToken(refreshToken);
    if (!verified) {
        return {
            ok: false,
            status: 401,
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
            ok: false,
            status: 401,
            body: {
                error: 'Refresh token account not found',
            },
        };
    }
    if (account.role !== Role.Delivery_Operator) {
        return {
            ok: false,
            status: 403,
            body: {
                error: 'Delivery operator account required',
            },
        };
    }
    if (account.account_status !== AccountStatus.Active) {
        return {
            ok: false,
            status: 403,
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
        ok: true,
        status: 200,
        body: {
            accessToken,
            expiresIn: getLocalAccessTokenExpiresInSeconds(),
        },
    };
};
