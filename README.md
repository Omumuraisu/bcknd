```
npm install
npx prisma generate
npm run check:db
npm run dev
```

```
open http://localhost:3000
```

If you get Prisma `P1001` (database not reachable):

```
Test-NetConnection <your-db-host> -Port 5432
nslookup <your-db-host>
```

## Supabase Auth (Incremental Setup)

1. Add Supabase variables to your `.env` based on `.env.example`:
	- `SUPABASE_URL`
	- `SUPABASE_ANON_KEY`
	- `SUPABASE_SERVICE_ROLE_KEY`
2. Run the SQL in `supabase/sql/001_auth_user_mapping.sql` inside Supabase SQL Editor.
3. Regenerate Prisma client after schema updates:

```
npx prisma generate
```

Notes:
- Auth and RBAC middleware are enabled on admin management endpoints.
- Existing `account_id` bigint keys remain unchanged; Supabase users are linked via `Account.supabase_user_id`.

## OTP Provider (Temporary Local Mode)

Activation endpoints for business owners, vendors, and hub staff are controlled by `OTP_PROVIDER`.

- `OTP_PROVIDER=local`: uses the temporary database-backed OTP flow.
- `OTP_PROVIDER=supabase`: activation endpoints return `503` until Supabase OTP send/verify handlers are implemented.

Safety behavior:
- In development (`NODE_ENV != production`), activation request responses include `otpCode` for local testing.
- In production, `otpCode` is never returned.
- If `OTP_PROVIDER` is missing, defaults are fail-safe: development defaults to `local`, production defaults to `supabase`.

## Local Login And Email Verification

Local username/password login is available via `/api/auth/login`.

- Login identifier supports either `email` or `phone` (field name: `identifier`).
- Login requires `AUTH_JWT_SECRET` in backend env.
- Login returns a bearer access token accepted by protected admin routes.

Email verification flow:

1. `POST /api/auth/request-email-verification`
	- Body: `{ "identifier": "email-or-phone" }`
	- Returns verification code in development only.
2. `POST /api/auth/verify-email`
	- Body: `{ "identifier": "email-or-phone", "verificationCode": "123456" }`
3. `POST /api/auth/login`
	- Body: `{ "identifier": "email-or-phone", "password": "..." }`

Accounts with unverified email receive a `403` login response with `needsEmailVerification: true`.

Admin password setup flow:

1. `POST /api/auth/admin/request-password-setup`
	- Body: `{ "identifier": "admin-email-or-phone" }`
	- Returns verification code in development only.
2. `POST /api/auth/admin/create-password`
	- Body: `{ "identifier": "admin-email-or-phone", "verificationCode": "123456", "newPassword": "..." }`
3. `POST /api/auth/login`
	- Body: `{ "identifier": "admin-email-or-phone", "password": "..." }`

Only `Role.Admin` accounts can use these admin password setup endpoints.

## Mobile Offline Sync Contracts

Apply the sync schema SQL in Supabase SQL Editor:

1. `supabase/sql/003_mobile_offline_sync_contracts.sql`

Mounted sync endpoints:

- `POST /api/sync/tickets`
- `POST /api/sync/unloading/start`
- `POST /api/sync/unloading/done`
- `GET /api/sync/unloading/snapshot`
- `GET /api/sync/tickets/snapshot`
- `GET /api/sync/dashboard`

Write envelope fields:

- `idempotencyKey`
- `entityType`
- `operation`
- `entityId`
- `payload`
- `queuedAt`

Reference docs:

- `docs/mobile-sync-contracts.md`
- `postman/mobile-sync-offline.collection.json`
