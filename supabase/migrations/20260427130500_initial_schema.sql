create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'gestor', 'operador');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.workflow_stage as enum ('CUMPRIMENTO', 'QUALIDADE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.event_type as enum ('PENDENTE', 'ENTREGUE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sentence_status as enum ('ENTREGUE', 'PENDENTE', 'EM ANDAMENTO', 'ESTOQUE');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.app_role not null default 'operador',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_kind text not null default 'xlsx',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  warning_rows integer not null default 0,
  duplicate_sentence_ids integer not null default 0,
  duplicate_processos integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sentences (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.import_batches(id) on delete set null,
  import_row_number integer,
  legacy_id_sentenca text,
  processo text not null,
  data_publicacao date,
  envio_bcc date,
  origem_raw text,
  origem_normalized text,
  tratado date,
  tipo_justica_raw text,
  tipo_justica_normalized text,
  cpf_cnpj text,
  autor text,
  tipo_cliente text,
  uc text,
  municipio_raw text,
  municipio_normalized text,
  tipo_decisao_raw text,
  tipo_decisao_normalized text,
  observacao text,
  valor_multa numeric(14, 2),
  prazo_fatal date,
  tipo_servico_raw text,
  responsavel_cumprimento text,
  responsavel_qualidade text,
  cumprimento_status public.sentence_status,
  qualidade_status public.sentence_status,
  cumprimento_data date,
  qualidade_data date,
  data_ultimo_evento date,
  raw_import_payload jsonb not null default '{}'::jsonb,
  import_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sentences_processo_idx on public.sentences (processo);
create index if not exists sentences_legacy_id_idx on public.sentences (legacy_id_sentenca);
create index if not exists sentences_cumprimento_status_idx on public.sentences (cumprimento_status);
create index if not exists sentences_qualidade_status_idx on public.sentences (qualidade_status);
create index if not exists sentences_responsavel_cumprimento_idx on public.sentences (responsavel_cumprimento);
create index if not exists sentences_responsavel_qualidade_idx on public.sentences (responsavel_qualidade);
create index if not exists sentences_data_ultimo_evento_idx on public.sentences (data_ultimo_evento desc);

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.sentence_services (
  sentence_id uuid not null references public.sentences(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  primary key (sentence_id, service_type_id)
);

create table if not exists public.sentence_events (
  id uuid primary key default gen_random_uuid(),
  sentence_id uuid not null references public.sentences(id) on delete cascade,
  etapa public.workflow_stage not null,
  tipo_evento public.event_type not null,
  data_evento date not null,
  responsavel text,
  pendencia text,
  area text,
  obs text,
  raw_import_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists sentence_events_sentence_stage_date_idx
  on public.sentence_events (sentence_id, etapa, data_evento desc, created_at desc);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  sentence_id uuid not null references public.sentences(id) on delete cascade,
  event_id uuid references public.sentence_events(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.import_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  sheet_name text,
  row_number integer,
  severity text not null check (severity in ('warning', 'error')),
  field_name text,
  message text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists sentences_touch_updated_at on public.sentences;
create trigger sentences_touch_updated_at
before update on public.sentences
for each row execute function public.touch_updated_at();

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true
$$;

create or replace function public.current_profile_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(full_name, split_part(email, '@', 1)) from public.profiles where id = auth.uid() and active = true
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('admin', 'gestor'), false)
$$;

create or replace function public.can_access_sentence(sentence_row public.sentences)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_manager()
    or upper(coalesce(sentence_row.responsavel_cumprimento, '')) = upper(coalesce(public.current_profile_name(), ''))
    or upper(coalesce(sentence_row.responsavel_qualidade, '')) = upper(coalesce(public.current_profile_name(), ''))
$$;

create or replace function public.apply_sentence_event()
returns trigger
language plpgsql
as $$
begin
  update public.sentences
     set data_ultimo_evento = new.data_evento,
         cumprimento_status = case when new.etapa = 'CUMPRIMENTO' then new.tipo_evento::text::public.sentence_status else cumprimento_status end,
         qualidade_status = case when new.etapa = 'QUALIDADE' then new.tipo_evento::text::public.sentence_status else qualidade_status end,
         cumprimento_data = case when new.etapa = 'CUMPRIMENTO' and new.tipo_evento = 'ENTREGUE' then new.data_evento else cumprimento_data end,
         qualidade_data = case when new.etapa = 'QUALIDADE' and new.tipo_evento = 'ENTREGUE' then new.data_evento else qualidade_data end
   where id = new.sentence_id;
  return new;
end;
$$;

drop trigger if exists sentence_events_apply_to_sentence on public.sentence_events;
create trigger sentence_events_apply_to_sentence
after insert on public.sentence_events
for each row execute function public.apply_sentence_event();

alter table public.profiles enable row level security;
alter table public.import_batches enable row level security;
alter table public.sentences enable row level security;
alter table public.service_types enable row level security;
alter table public.sentence_services enable row level security;
alter table public.sentence_events enable row level security;
alter table public.attachments enable row level security;
alter table public.import_errors enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select using (id = auth.uid() or public.is_manager());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
for all using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists sentences_select_by_role on public.sentences;
create policy sentences_select_by_role on public.sentences
for select using (public.can_access_sentence(sentences));

drop policy if exists sentences_manager_write on public.sentences;
create policy sentences_manager_write on public.sentences
for all using (public.is_manager())
with check (public.is_manager());

drop policy if exists events_select_by_sentence on public.sentence_events;
create policy events_select_by_sentence on public.sentence_events
for select using (
  exists (select 1 from public.sentences s where s.id = sentence_events.sentence_id and public.can_access_sentence(s))
);

drop policy if exists events_insert_accessible_sentence on public.sentence_events;
create policy events_insert_accessible_sentence on public.sentence_events
for insert with check (
  exists (select 1 from public.sentences s where s.id = sentence_events.sentence_id and public.can_access_sentence(s))
);

drop policy if exists manager_read_imports on public.import_batches;
create policy manager_read_imports on public.import_batches for select using (public.is_manager());

drop policy if exists manager_write_imports on public.import_batches;
create policy manager_write_imports on public.import_batches for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists manager_read_import_errors on public.import_errors;
create policy manager_read_import_errors on public.import_errors for select using (public.is_manager());

drop policy if exists manager_write_import_errors on public.import_errors;
create policy manager_write_import_errors on public.import_errors for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists service_types_read on public.service_types;
create policy service_types_read on public.service_types for select using (auth.uid() is not null);

drop policy if exists service_types_manager_write on public.service_types;
create policy service_types_manager_write on public.service_types for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists sentence_services_read on public.sentence_services;
create policy sentence_services_read on public.sentence_services
for select using (
  exists (select 1 from public.sentences s where s.id = sentence_services.sentence_id and public.can_access_sentence(s))
);

drop policy if exists sentence_services_manager_write on public.sentence_services;
create policy sentence_services_manager_write on public.sentence_services for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists attachments_read on public.attachments;
create policy attachments_read on public.attachments
for select using (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
);

drop policy if exists attachments_write on public.attachments;
create policy attachments_write on public.attachments
for all using (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
) with check (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
);
