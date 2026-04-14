import { prisma } from '../lib/prisma.js';
import { verifySupabaseAccessToken } from '../lib/supabase-auth.js';
import { AccountStatus, Role } from '../generated/prisma/client';
import { verifyLocalAccessToken } from '../lib/local-auth.js';
export const getBearerToken = (authorizationHeader) => {
    if (!authorizationHeader)
        return null;
    const [scheme, token] = authorizationHeader.split(' ');
    if (!scheme || !token)
        return null;
    if (scheme.toLowerCase() !== 'bearer')
        return null;
    return token.trim();
};
// Scaffold only: not mounted yet. Call this middleware on routes when you are ready to enforce auth.
export const requireAuth = async (c, next) => {
    const token = getBearerToken(c.req.header('Authorization'));
    if (!token) {
        return c.json({ error: 'Missing bearer token' }, 401);
    }
    const localToken = verifyLocalAccessToken(token);
    if (localToken) {
        const accountId = BigInt(localToken.sub);
        const account = await prisma.account.findUnique({
            where: {
                account_id: accountId,
            },
            select: {
                account_id: true,
                role: true,
                account_status: true,
            },
        });
        if (!account) {
            return c.json({ error: 'Account mapping not found' }, 403);
        }
        if (account.account_status !== AccountStatus.Active) {
            return c.json({ error: 'Account is not active' }, 403);
        }
        c.set('auth', {
            supabaseUserId: localToken.sub,
            accountId: account.account_id,
            role: account.role,
            accountStatus: account.account_status,
        });
        await next();
        return;
    }
    const verified = await verifySupabaseAccessToken(token);
    if (!verified) {
        return c.json({ error: 'Invalid or expired token' }, 401);
    }
    const account = await prisma.account.findFirst({
        where: {
            supabase_user_id: verified.id,
        },
        select: {
            account_id: true,
            role: true,
            account_status: true,
        },
    });
    if (!account) {
        return c.json({ error: 'Account mapping not found' }, 403);
    }
    if (account.account_status !== AccountStatus.Active) {
        return c.json({ error: 'Account is not active' }, 403);
    }
    c.set('auth', {
        supabaseUserId: verified.id,
        accountId: account.account_id,
        role: account.role,
        accountStatus: account.account_status,
    });
    await next();
};
