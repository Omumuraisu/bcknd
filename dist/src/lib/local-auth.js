import jwt from 'jsonwebtoken';
import { Role } from '../generated/prisma/client';
const DEFAULT_EXPIRY = '12h';
const DEFAULT_REFRESH_EXPIRY = '30d';
const parseExpiresInToSeconds = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value !== 'string') {
        return 900;
    }
    const normalized = value.trim().toLowerCase();
    const direct = Number(normalized);
    if (Number.isFinite(direct) && direct > 0) {
        return Math.floor(direct);
    }
    const match = normalized.match(/^(\d+)\s*(s|m|h|d)$/);
    if (!match) {
        return 900;
    }
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) {
        return 900;
    }
    if (unit === 's')
        return amount;
    if (unit === 'm')
        return amount * 60;
    if (unit === 'h')
        return amount * 60 * 60;
    return amount * 60 * 60 * 24;
};
export const getLocalAccessTokenExpiresIn = () => process.env.AUTH_JWT_EXPIRES_IN ??
    DEFAULT_EXPIRY;
export const getLocalAccessTokenExpiresInSeconds = () => parseExpiresInToSeconds(getLocalAccessTokenExpiresIn());
const getLocalRefreshTokenExpiresIn = () => process.env.AUTH_REFRESH_EXPIRES_IN ??
    DEFAULT_REFRESH_EXPIRY;
const getJwtSecret = () => {
    const secret = process.env.AUTH_JWT_SECRET?.trim();
    if (!secret) {
        throw new Error('AUTH_JWT_SECRET is required for local login.');
    }
    return secret;
};
export const signLocalAccessToken = (payload) => {
    const secret = getJwtSecret();
    const expiresIn = getLocalAccessTokenExpiresIn();
    return jwt.sign({
        sub: payload.accountId.toString(),
        role: payload.role,
        type: 'local_access',
    }, secret, {
        issuer: 'leeo-backend',
        expiresIn,
    });
};
export const signLocalRefreshToken = (payload) => {
    const secret = getJwtSecret();
    const expiresIn = getLocalRefreshTokenExpiresIn();
    return jwt.sign({
        sub: payload.accountId.toString(),
        role: payload.role,
        type: 'local_refresh',
    }, secret, {
        issuer: 'leeo-backend',
        expiresIn,
    });
};
export const verifyLocalAccessToken = (token) => {
    const secret = process.env.AUTH_JWT_SECRET?.trim();
    if (!secret)
        return null;
    try {
        const decoded = jwt.verify(token, secret, {
            issuer: 'leeo-backend',
        });
        if (typeof decoded !== 'object' || !decoded)
            return null;
        const sub = decoded.sub;
        const role = decoded.role;
        const type = decoded.type;
        if (typeof sub !== 'string')
            return null;
        if (!Object.values(Role).includes(role))
            return null;
        if (type !== 'local_access')
            return null;
        return {
            sub,
            role: role,
            type: 'local_access',
        };
    }
    catch {
        return null;
    }
};
export const verifyLocalRefreshToken = (token) => {
    const secret = process.env.AUTH_JWT_SECRET?.trim();
    if (!secret)
        return null;
    try {
        const decoded = jwt.verify(token, secret, {
            issuer: 'leeo-backend',
        });
        if (typeof decoded !== 'object' || !decoded)
            return null;
        const sub = decoded.sub;
        const role = decoded.role;
        const type = decoded.type;
        if (typeof sub !== 'string')
            return null;
        if (!Object.values(Role).includes(role))
            return null;
        if (type !== 'local_refresh')
            return null;
        return {
            sub,
            role: role,
            type: 'local_refresh',
        };
    }
    catch {
        return null;
    }
};
