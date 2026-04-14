# Mobile Offline Sync Contracts

## Auth And Access
- All `/api/sync/*` routes require `Authorization: Bearer <token>`.
- `401`: missing/invalid bearer token.
- `403`: authenticated role not allowed (`Role.Admin` and `Role.Delivery_Operator` are allowed).

## Request Envelope (Write Endpoints)
```json
{
  "idempotencyKey": "4c3d2db7-4a88-49f0-9123-a1400e03ccbf",
  "entityType": "tickets",
  "operation": "upsert",
  "entityId": "9ca30b76-0c32-4c74-a3e7-895e7c35ab8b",
  "payload": {},
  "queuedAt": "2026-03-22T10:00:00.000Z",
  "sourceDeviceId": "android-device-01"
}
```

## Response Shapes
### Success (200)
```json
{
  "success": true,
  "data": {}
}
```

### Validation Error (400)
```json
{
  "error": "Missing required payload fields",
  "fields": ["transaction_id", "ticket_no"]
}
```

### Conflict (409)
```json
{
  "code": "conflict",
  "message": "Ticket version mismatch",
  "entityType": "tickets",
  "entityId": "9ca30b76-0c32-4c74-a3e7-895e7c35ab8b",
  "serverVersion": 4,
  "serverRecord": {
    "id": "9ca30b76-0c32-4c74-a3e7-895e7c35ab8b",
    "version": 4,
    "updated_at": "2026-03-22T10:15:11.120Z"
  },
  "conflictFields": ["total_amount", "items"]
}
```

### Unauthorized (401)
```json
{
  "error": "Missing bearer token"
}
```

### Forbidden (403)
```json
{
  "error": "Forbidden for current role"
}
```

### Dependency Failure (503)
```json
{
  "error": "Temporary service dependency failure"
}
```

## Snapshot Endpoints
- `GET /api/sync/unloading/snapshot`
- `GET /api/sync/tickets/snapshot`

Rules:
- Full normalized rows are returned.
- Include `id`, `created_at`, `updated_at`, `version`, `deleted_at`.
- Sorted by `updated_at desc, id asc`.
- Soft-delete policy: rows include `deleted_at` consistently.

## Dashboard Endpoint
- `GET /api/sync/dashboard`

Response:
```json
{
  "success": true,
  "data": {
    "totalAmountIssued": 0,
    "totalDeliveries": 0,
    "waitingVehicles": 0
  }
}
```

## Idempotency Replay Behavior
- Write routes accept `idempotencyKey`.
- Repeated same key + same envelope returns the stored response payload.
- Reusing the same key with a different envelope returns `409 conflict`.
- This guarantees retry-safe duplicate submit behavior.

## Write Endpoint Quick Examples

### POST /api/sync/tickets
Success `200`:
```json
{
  "success": true,
  "data": {
    "id": "9ca30b76-0c32-4c74-a3e7-895e7c35ab8b",
    "transaction_id": "txn-mobile-0001",
    "version": 1
  }
}
```

### POST /api/sync/unloading/start
Success `200`:
```json
{
  "success": true,
  "data": {
    "id": "de4f893b-227f-4f0b-a9dd-b0e68f77be7a",
    "completed_at": null,
    "version": 1
  }
}
```

### POST /api/sync/unloading/done
Success `200`:
```json
{
  "success": true,
  "data": {
    "id": "de4f893b-227f-4f0b-a9dd-b0e68f77be7a",
    "completed_at": "2026-03-22T11:20:00.000Z",
    "version": 2
  }
}
```
