create table if not exists public.salesforce_orders (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  import_row_number integer not null,
  is_latest boolean not null default false,
  processo text,
  processo_source text,
  owner_name text,
  supply_point_number text,
  subject text,
  salesforce_case_number text,
  case_status text,
  status_bucket text not null default 'unknown' check (status_bucket in ('open', 'closed', 'unknown')),
  is_open boolean not null default false,
  order_number text,
  order_state text,
  synergia_order_number text,
  order_status text,
  order_key text,
  opened_at timestamptz,
  created_on date,
  reason text,
  subreason text,
  origin_channel text,
  municipality text,
  case_observations text,
  company_client_id text,
  observations_prefixed text,
  observations text,
  segment_type text,
  primary_contact_name text,
  raw_import_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists salesforce_orders_latest_processo_idx
  on public.salesforce_orders (processo, opened_at desc, import_row_number desc)
  where is_latest;
create index if not exists salesforce_orders_import_batch_idx
  on public.salesforce_orders (import_batch_id);
create index if not exists salesforce_orders_status_bucket_idx
  on public.salesforce_orders (status_bucket)
  where is_latest;
create index if not exists salesforce_orders_order_key_idx
  on public.salesforce_orders (order_key)
  where is_latest and order_key is not null;
alter table public.salesforce_orders enable row level security;
drop policy if exists salesforce_orders_select_by_sentence on public.salesforce_orders;
create policy salesforce_orders_select_by_sentence on public.salesforce_orders
for select using (
  exists (
    select 1
    from public.sentences s
    where s.processo = salesforce_orders.processo
      and public.can_access_sentence(s)
  )
);
drop policy if exists salesforce_orders_manager_write on public.salesforce_orders;
create policy salesforce_orders_manager_write on public.salesforce_orders
for all using (public.is_manager())
with check (public.is_manager());
