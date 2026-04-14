-- Mobile offline sync contracts: queue/unloading/tickets + idempotency ledger

create table if not exists public.sync_unloading_record (
  id uuid primary key,
  queue_number text not null,
  vehicle_number text not null,
  vehicle_type text not null,
  product_category text not null,
  started_at timestamptz not null,
  estimated_minutes integer not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  source_device_id text,
  last_idempotency_key text,
  sync_status text
);

create table if not exists public.sync_ticket_record (
  id uuid primary key,
  transaction_id text not null,
  ticket_no text not null,
  vehicle_number text not null,
  vehicle_type text not null,
  goods_type text not null,
  unloading_time timestamptz not null,
  suggested_unloading_time timestamptz not null,
  total_amount numeric(14,2) not null,
  issued_at timestamptz not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  source_device_id text,
  last_idempotency_key text,
  sync_status text
);

create table if not exists public.sync_idempotency_ledger (
  id bigserial primary key,
  idempotency_key text not null,
  entity_type text not null,
  operation text not null,
  entity_id text not null,
  request_hash text not null,
  response_status integer not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (idempotency_key, entity_type, operation)
);

create unique index if not exists idx_sync_ticket_transaction_id
  on public.sync_ticket_record(transaction_id);

create index if not exists idx_sync_unloading_updated_at
  on public.sync_unloading_record(updated_at desc);

create index if not exists idx_sync_ticket_updated_at
  on public.sync_ticket_record(updated_at desc);

create index if not exists idx_sync_idempotency_lookup
  on public.sync_idempotency_ledger(entity_type, operation, entity_id);

create or replace function public.sync_set_update_fields()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists trg_sync_unloading_set_update_fields on public.sync_unloading_record;
create trigger trg_sync_unloading_set_update_fields
before update on public.sync_unloading_record
for each row execute procedure public.sync_set_update_fields();

drop trigger if exists trg_sync_ticket_set_update_fields on public.sync_ticket_record;
create trigger trg_sync_ticket_set_update_fields
before update on public.sync_ticket_record
for each row execute procedure public.sync_set_update_fields();
