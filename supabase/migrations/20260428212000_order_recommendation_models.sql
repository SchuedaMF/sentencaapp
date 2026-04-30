create table if not exists public.order_recommendation_models (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null default 'salesforce_orders_subreason',
  model_version text not null,
  is_active boolean not null default false,
  generated_at timestamptz not null default now(),
  training_metrics jsonb not null default '{}'::jsonb,
  model_payload jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_recommendation_models_payload_object check (jsonb_typeof(model_payload) = 'object'),
  constraint order_recommendation_models_metrics_object check (jsonb_typeof(training_metrics) = 'object')
);

create index if not exists order_recommendation_models_source_generated_idx
  on public.order_recommendation_models (source_kind, generated_at desc);

create unique index if not exists order_recommendation_models_one_active_per_source_idx
  on public.order_recommendation_models (source_kind)
  where is_active;

alter table public.order_recommendation_models enable row level security;

drop policy if exists order_recommendation_models_authenticated_read on public.order_recommendation_models;
create policy order_recommendation_models_authenticated_read on public.order_recommendation_models
for select using (auth.uid() is not null);

drop policy if exists order_recommendation_models_manager_write on public.order_recommendation_models;
create policy order_recommendation_models_manager_write on public.order_recommendation_models
for all using (public.is_manager())
with check (public.is_manager());
