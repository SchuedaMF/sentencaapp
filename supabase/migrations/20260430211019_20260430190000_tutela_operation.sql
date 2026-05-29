create table if not exists public.tutela_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_kind text not null default 'xlsx:tutelas',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  warning_rows integer not null default 0,
  duplicate_tutela_ids integer not null default 0,
  duplicate_processos integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tutelas (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.tutela_import_batches(id) on delete set null,
  import_row_number integer,
  legacy_id_tutela text,
  processo text not null,
  data_chegada date,
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
  endereco_obf text,
  municipio_raw text,
  municipio_normalized text,
  situacao_liminar_raw text,
  situacao_liminar_normalized text,
  advogado_responsavel text,
  obf text,
  valor_multa numeric(14, 2),
  prazo_fatal date,
  obs_pendente text,
  pendencia text,
  prioridade text,
  numero_ordem text,
  responsavel_cumprimento text,
  responsavel_qualidade text,
  cumprimento_status public.sentence_status,
  qualidade_status public.sentence_status,
  cumprimento_data date,
  qualidade_data date,
  obs_qualidade text,
  data_pendente date,
  data_ultimo_evento date,
  cumprimento_base_status public.sentence_status,
  qualidade_base_status public.sentence_status,
  cumprimento_base_data date,
  qualidade_base_data date,
  data_ultimo_evento_base date,
  raw_import_payload jsonb not null default '{}'::jsonb,
  import_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutelas_processo_idx on public.tutelas (processo);
create index if not exists tutelas_legacy_id_idx on public.tutelas (legacy_id_tutela);
create index if not exists tutelas_cumprimento_status_idx on public.tutelas (cumprimento_status);
create index if not exists tutelas_qualidade_status_idx on public.tutelas (qualidade_status);
create index if not exists tutelas_responsavel_cumprimento_idx on public.tutelas (responsavel_cumprimento);
create index if not exists tutelas_responsavel_qualidade_idx on public.tutelas (responsavel_qualidade);
create index if not exists tutelas_data_ultimo_evento_idx on public.tutelas (data_ultimo_evento desc);
create index if not exists tutelas_prazo_fatal_idx on public.tutelas (prazo_fatal);
create index if not exists tutelas_quality_ready_idx
  on public.tutelas (qualidade_status, cumprimento_data desc nulls last, id)
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;

drop trigger if exists tutelas_touch_updated_at on public.tutelas;
create trigger tutelas_touch_updated_at
before update on public.tutelas
for each row execute function public.touch_updated_at();

create table if not exists public.tutela_events (
  id uuid primary key default gen_random_uuid(),
  tutela_id uuid not null references public.tutelas(id) on delete cascade,
  etapa public.workflow_stage not null,
  status public.sentence_status not null check (status <> 'ESTOQUE'::public.sentence_status),
  data_evento date not null,
  responsavel text,
  motivo text,
  area text,
  obs text,
  affects_operational_state boolean not null default true,
  legacy_id_tutela_event text,
  import_batch_id uuid references public.tutela_import_batches(id) on delete set null,
  import_row_number integer,
  raw_import_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutela_events_tutela_stage_date_idx
  on public.tutela_events (tutela_id, etapa, data_evento desc, created_at desc);
create index if not exists tutela_events_legacy_idx on public.tutela_events (legacy_id_tutela_event);
create index if not exists tutela_events_import_batch_idx on public.tutela_events (import_batch_id);

drop trigger if exists tutela_events_touch_updated_at on public.tutela_events;
create trigger tutela_events_touch_updated_at
before update on public.tutela_events
for each row execute function public.touch_updated_at();

create table if not exists public.tutela_import_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.tutela_import_batches(id) on delete cascade,
  sheet_name text,
  row_number integer,
  severity text not null check (severity in ('warning', 'error')),
  field_name text,
  message text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tutela_import_errors_batch_idx on public.tutela_import_errors (import_batch_id);

create or replace function public.can_access_tutela(tutela_row public.tutelas)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_manager()
    or upper(coalesce(tutela_row.responsavel_cumprimento, '')) = upper(coalesce(public.current_profile_name(), ''))
    or upper(coalesce(tutela_row.responsavel_qualidade, '')) = upper(coalesce(public.current_profile_name(), ''))
$$;

create or replace function public.recalculate_tutela_event_state(target_tutela_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tutelas;
  cumprimento_event record;
  qualidade_event record;
  latest_event_date date;
  next_cumprimento_status public.sentence_status;
  next_qualidade_status public.sentence_status;
  next_cumprimento_data date;
  next_qualidade_data date;
  next_ultimo_evento date;
begin
  select * into current_row from public.tutelas where id = target_tutela_id;
  if not found then
    return;
  end if;

  select etapa, status, data_evento
    into cumprimento_event
    from public.tutela_events
   where tutela_id = target_tutela_id
     and etapa = 'CUMPRIMENTO'::public.workflow_stage
     and affects_operational_state
   order by data_evento desc, created_at desc, id desc
   limit 1;

  select etapa, status, data_evento
    into qualidade_event
    from public.tutela_events
   where tutela_id = target_tutela_id
     and etapa = 'QUALIDADE'::public.workflow_stage
     and affects_operational_state
   order by data_evento desc, created_at desc, id desc
   limit 1;

  select max(data_evento)
    into latest_event_date
    from public.tutela_events
   where tutela_id = target_tutela_id
     and affects_operational_state;

  next_cumprimento_status := coalesce(cumprimento_event.status, current_row.cumprimento_base_status);
  next_qualidade_status := coalesce(qualidade_event.status, current_row.qualidade_base_status);
  next_cumprimento_data := case
    when cumprimento_event.status = 'ENTREGUE'::public.sentence_status then cumprimento_event.data_evento
    when cumprimento_event.status is not null then current_row.cumprimento_base_data
    else current_row.cumprimento_base_data
  end;
  next_qualidade_data := case
    when qualidade_event.status = 'ENTREGUE'::public.sentence_status then qualidade_event.data_evento
    when qualidade_event.status is not null then current_row.qualidade_base_data
    else current_row.qualidade_base_data
  end;

  if next_qualidade_status = 'ENTREGUE'::public.sentence_status
     and next_cumprimento_status is distinct from 'ENTREGUE'::public.sentence_status then
    next_cumprimento_status := 'ENTREGUE'::public.sentence_status;
    next_cumprimento_data := coalesce(next_cumprimento_data, next_qualidade_data, qualidade_event.data_evento);
  end if;

  next_ultimo_evento := greatest(
    coalesce(current_row.data_ultimo_evento_base, '0001-01-01'::date),
    coalesce(latest_event_date, '0001-01-01'::date)
  );

  update public.tutelas
     set cumprimento_status = next_cumprimento_status,
         qualidade_status = next_qualidade_status,
         cumprimento_data = next_cumprimento_data,
         qualidade_data = next_qualidade_data,
         data_ultimo_evento = nullif(next_ultimo_evento, '0001-01-01'::date)
   where id = target_tutela_id;
end;
$$;

create or replace function public.recalculate_tutela_event_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_tutela_event_state(old.tutela_id);
    return old;
  end if;

  perform public.recalculate_tutela_event_state(new.tutela_id);
  return new;
end;
$$;

drop trigger if exists tutela_events_recalculate_after_insert on public.tutela_events;
create trigger tutela_events_recalculate_after_insert
after insert on public.tutela_events
for each row execute function public.recalculate_tutela_event_state_trigger();

drop trigger if exists tutela_events_recalculate_after_update on public.tutela_events;
create trigger tutela_events_recalculate_after_update
after update on public.tutela_events
for each row execute function public.recalculate_tutela_event_state_trigger();

drop trigger if exists tutela_events_recalculate_after_delete on public.tutela_events;
create trigger tutela_events_recalculate_after_delete
after delete on public.tutela_events
for each row execute function public.recalculate_tutela_event_state_trigger();

alter table public.tutela_import_batches enable row level security;
alter table public.tutelas enable row level security;
alter table public.tutela_events enable row level security;
alter table public.tutela_import_errors enable row level security;

drop policy if exists tutela_import_batches_manager_read on public.tutela_import_batches;
create policy tutela_import_batches_manager_read on public.tutela_import_batches
for select using (public.is_manager());

drop policy if exists tutela_import_batches_manager_write on public.tutela_import_batches;
create policy tutela_import_batches_manager_write on public.tutela_import_batches
for all using (public.is_manager())
with check (public.is_manager());

drop policy if exists tutelas_select_by_role on public.tutelas;
create policy tutelas_select_by_role on public.tutelas
for select using (public.can_access_tutela(tutelas));

drop policy if exists tutelas_manager_write on public.tutelas;
create policy tutelas_manager_write on public.tutelas
for all using (public.is_manager())
with check (public.is_manager());

drop policy if exists tutela_events_select_accessible on public.tutela_events;
create policy tutela_events_select_accessible on public.tutela_events
for select using (
  exists (select 1 from public.tutelas t where t.id = tutela_events.tutela_id and public.can_access_tutela(t))
);

drop policy if exists tutela_events_insert_accessible on public.tutela_events;
create policy tutela_events_insert_accessible on public.tutela_events
for insert with check (
  exists (select 1 from public.tutelas t where t.id = tutela_events.tutela_id and public.can_access_tutela(t))
);

drop policy if exists tutela_events_update_accessible on public.tutela_events;
create policy tutela_events_update_accessible on public.tutela_events
for update using (
  exists (select 1 from public.tutelas t where t.id = tutela_events.tutela_id and public.can_access_tutela(t))
) with check (
  exists (select 1 from public.tutelas t where t.id = tutela_events.tutela_id and public.can_access_tutela(t))
);

drop policy if exists tutela_events_delete_accessible on public.tutela_events;
create policy tutela_events_delete_accessible on public.tutela_events
for delete using (
  exists (select 1 from public.tutelas t where t.id = tutela_events.tutela_id and public.can_access_tutela(t))
);

drop policy if exists tutela_import_errors_manager_read on public.tutela_import_errors;
create policy tutela_import_errors_manager_read on public.tutela_import_errors
for select using (public.is_manager());

drop policy if exists tutela_import_errors_manager_write on public.tutela_import_errors;
create policy tutela_import_errors_manager_write on public.tutela_import_errors
for all using (public.is_manager())
with check (public.is_manager());

create or replace function public.tutela_operational_queue_summary(
  stage_arg public.workflow_stage,
  responsible_arg text default null,
  q_arg text default null
)
returns table(kind text, value text, item_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term
  ),
  scoped as (
    select
      t.*,
      case when stage_arg = 'CUMPRIMENTO' then t.cumprimento_status else t.qualidade_status end as queue_status,
      case when stage_arg = 'CUMPRIMENTO' then t.responsavel_cumprimento else t.responsavel_qualidade end as queue_responsible
    from public.tutelas t
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (p.is_manager or upper(coalesce(t.responsavel_cumprimento, '')) = upper(p.profile_name))
      and (not p.is_manager or p.responsible_filter is null or p.responsible_filter = 'ALL' or t.responsavel_cumprimento = p.responsible_filter)
    )
    or (
      stage_arg = 'QUALIDADE'
      and t.cumprimento_status = 'ENTREGUE'::public.sentence_status
      and (p.is_manager or upper(coalesce(t.responsavel_qualidade, '')) = upper(p.profile_name))
      and (not p.is_manager or p.responsible_filter is null or p.responsible_filter = 'ALL' or t.responsavel_qualidade = p.responsible_filter)
    )
  ),
  filtered as (
    select scoped.*
    from scoped
    cross join params p
    where p.search_term is null
       or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, ''))
          like '%' || upper(p.search_term) || '%'
  )
  select 'status', queue_status::text, count(*)::bigint
    from filtered
   where queue_status is not null
   group by queue_status
  union all
  select 'responsible', queue_responsible, count(*)::bigint
    from filtered
   where queue_responsible is not null and trim(queue_responsible) <> ''
   group by queue_responsible
  union all
  select 'total', null, count(*)::bigint from filtered;
$$;

create or replace function public.tutela_operational_queue_items(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'EM ANDAMENTO',
  responsible_arg text default null,
  q_arg text default null,
  cursor_arg text default null,
  page_size_arg integer default 50,
  sort_key_arg text default null,
  sort_direction_arg text default 'asc'
)
returns table(
  id uuid,
  legacy_id_tutela text,
  processo text,
  data_chegada date,
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
  endereco_obf text,
  municipio_raw text,
  municipio_normalized text,
  situacao_liminar_raw text,
  advogado_responsavel text,
  obf text,
  valor_multa numeric,
  prazo_fatal date,
  obs_pendente text,
  pendencia text,
  prioridade text,
  numero_ordem text,
  responsavel_cumprimento text,
  responsavel_qualidade text,
  cumprimento_status public.sentence_status,
  qualidade_status public.sentence_status,
  cumprimento_data date,
  qualidade_data date,
  obs_qualidade text,
  data_pendente date,
  data_ultimo_evento date,
  import_warnings jsonb,
  next_cursor text,
  total_count bigint,
  order_total bigint,
  order_open bigint,
  order_closed bigint,
  order_unknown bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term,
      least(greatest(coalesce(page_size_arg, 50), 1), 100) as page_limit,
      case when coalesce(cursor_arg, '') ~ '^[0-9]+$' then least(cursor_arg::integer, 100000) else 0 end as cursor_offset,
      case
        when sort_key_arg in ('responsible', 'processo', 'status', 'stage_date', 'data_ultimo_evento', 'origem', 'sla', 'order_summary') then sort_key_arg
        else null
      end as sort_key,
      case when lower(coalesce(sort_direction_arg, 'asc')) = 'desc' then 'desc' else 'asc' end as sort_direction
  ),
  scoped as (
    select
      t.*,
      case when stage_arg = 'CUMPRIMENTO' then t.cumprimento_status else t.qualidade_status end as queue_status,
      public.queue_status_rank(case when stage_arg = 'CUMPRIMENTO' then t.cumprimento_status else t.qualidade_status end) as queue_rank,
      case when stage_arg = 'CUMPRIMENTO' then t.responsavel_cumprimento else t.responsavel_qualidade end as queue_responsible,
      case when stage_arg = 'CUMPRIMENTO' then t.envio_bcc else t.cumprimento_data end as stage_date,
      case when stage_arg = 'CUMPRIMENTO' then t.prazo_fatal else t.data_ultimo_evento end as sla_date
    from public.tutelas t
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (p.is_manager or upper(coalesce(t.responsavel_cumprimento, '')) = upper(p.profile_name))
      and (not p.is_manager or p.responsible_filter is null or p.responsible_filter = 'ALL' or t.responsavel_cumprimento = p.responsible_filter)
    )
    or (
      stage_arg = 'QUALIDADE'
      and t.cumprimento_status = 'ENTREGUE'::public.sentence_status
      and (p.is_manager or upper(coalesce(t.responsavel_qualidade, '')) = upper(p.profile_name))
      and (not p.is_manager or p.responsible_filter is null or p.responsible_filter = 'ALL' or t.responsavel_qualidade = p.responsible_filter)
    )
  ),
  filtered as (
    select scoped.*
    from scoped
    cross join params p
    where (
      status_mode_arg = 'ALL'
      or scoped.queue_status::text = status_mode_arg
    )
    and (
      p.search_term is null
      or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, ''))
        like '%' || upper(p.search_term) || '%'
    )
  ),
  sort_ready as (
    select
      filtered.*,
      coalesce(order_summary.total_orders, 0) as sort_order_total,
      coalesce(order_summary.open_orders, 0) as sort_order_open
    from filtered
    left join public.salesforce_order_process_summaries order_summary
      on order_summary.processo = filtered.processo
  ),
  ordered as (
    select
      sort_ready.*,
      count(*) over () as total_rows
    from sort_ready
    cross join params p
    order by
      case when p.sort_key is null then sort_ready.queue_rank end asc nulls last,
      case when p.sort_key is null then coalesce(sort_ready.data_ultimo_evento, '9999-12-31'::date) end asc nulls last,
      case when p.sort_key = 'responsible' and p.sort_direction = 'asc' then sort_ready.queue_responsible end asc nulls last,
      case when p.sort_key = 'responsible' and p.sort_direction = 'desc' then sort_ready.queue_responsible end desc nulls last,
      case when p.sort_key = 'processo' and p.sort_direction = 'asc' then sort_ready.processo end asc nulls last,
      case when p.sort_key = 'processo' and p.sort_direction = 'desc' then sort_ready.processo end desc nulls last,
      case when p.sort_key = 'status' and p.sort_direction = 'asc' then sort_ready.queue_rank end asc nulls last,
      case when p.sort_key = 'status' and p.sort_direction = 'desc' then sort_ready.queue_rank end desc nulls last,
      case when p.sort_key = 'stage_date' and p.sort_direction = 'asc' then sort_ready.stage_date end asc nulls last,
      case when p.sort_key = 'stage_date' and p.sort_direction = 'desc' then sort_ready.stage_date end desc nulls last,
      case when p.sort_key = 'data_ultimo_evento' and p.sort_direction = 'asc' then sort_ready.data_ultimo_evento end asc nulls last,
      case when p.sort_key = 'data_ultimo_evento' and p.sort_direction = 'desc' then sort_ready.data_ultimo_evento end desc nulls last,
      case when p.sort_key = 'origem' and p.sort_direction = 'asc' then sort_ready.origem_normalized end asc nulls last,
      case when p.sort_key = 'origem' and p.sort_direction = 'desc' then sort_ready.origem_normalized end desc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'asc' then sort_ready.sla_date end asc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'desc' then sort_ready.sla_date end desc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then sort_ready.sort_order_total end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then sort_ready.sort_order_total end desc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then sort_ready.sort_order_open end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then sort_ready.sort_order_open end desc nulls last,
      sort_ready.id asc
    offset (select cursor_offset from params)
    limit (select page_limit from params)
  )
  select
    ordered.id,
    ordered.legacy_id_tutela,
    ordered.processo,
    ordered.data_chegada,
    ordered.envio_bcc,
    ordered.origem_raw,
    ordered.origem_normalized,
    ordered.tratado,
    ordered.tipo_justica_raw,
    ordered.tipo_justica_normalized,
    ordered.cpf_cnpj,
    ordered.autor,
    ordered.tipo_cliente,
    ordered.uc,
    ordered.endereco_obf,
    ordered.municipio_raw,
    ordered.municipio_normalized,
    ordered.situacao_liminar_raw,
    ordered.advogado_responsavel,
    ordered.obf,
    ordered.valor_multa,
    ordered.prazo_fatal,
    ordered.obs_pendente,
    ordered.pendencia,
    ordered.prioridade,
    ordered.numero_ordem,
    ordered.responsavel_cumprimento,
    ordered.responsavel_qualidade,
    ordered.cumprimento_status,
    ordered.qualidade_status,
    ordered.cumprimento_data,
    ordered.qualidade_data,
    ordered.obs_qualidade,
    ordered.data_pendente,
    ordered.data_ultimo_evento,
    ordered.import_warnings,
    case
      when ordered.total_rows > (select cursor_offset + page_limit from params)
      then (select (cursor_offset + page_limit)::text from params)
      else null
    end as next_cursor,
    ordered.total_rows,
    coalesce(summary.total_orders, 0),
    coalesce(summary.open_orders, 0),
    coalesce(summary.closed_orders, 0),
    coalesce(summary.unknown_orders, 0)
  from ordered
  left join public.salesforce_order_process_summaries summary
    on summary.processo = ordered.processo;
$$;

create or replace function public.tutela_dashboard_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', current_date)::date as start_date, current_date as end_date
  ),
  days as (
    select generate_series(bounds.start_date, bounds.end_date, interval '1 day')::date as day
    from bounds
  ),
  accessible as (
    select t.*
    from public.tutelas t
    where public.can_access_tutela(t)
  ),
  status_cumprimento as (
    select coalesce(jsonb_object_agg(cumprimento_status::text, item_count), '{}'::jsonb) as payload
    from (
      select cumprimento_status, count(*)::bigint as item_count
      from accessible
      where cumprimento_status is not null
        and cumprimento_status <> 'ENTREGUE'::public.sentence_status
      group by cumprimento_status
    ) rows
  ),
  status_qualidade as (
    select coalesce(jsonb_object_agg(qualidade_status::text, item_count), '{}'::jsonb) as payload
    from (
      select qualidade_status, count(*)::bigint as item_count
      from accessible
      where qualidade_status is not null
        and qualidade_status <> 'ENTREGUE'::public.sentence_status
        and cumprimento_status = 'ENTREGUE'::public.sentence_status
      group by qualidade_status
    ) rows
  ),
  points as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', to_char(days.day, 'YYYY-MM-DD'),
      'recebido', (select count(*) from accessible a where a.envio_bcc = days.day),
      'cumprimento', (select count(*) from public.tutela_events e join accessible a on a.id = e.tutela_id where e.etapa = 'CUMPRIMENTO'::public.workflow_stage and e.data_evento = days.day),
      'qualidade', (select count(*) from public.tutela_events e join accessible a on a.id = e.tutela_id where e.etapa = 'QUALIDADE'::public.workflow_stage and e.data_evento = days.day),
      'pendente', (select count(*) from public.tutela_events e join accessible a on a.id = e.tutela_id where e.status = 'PENDENTE'::public.sentence_status and e.data_evento = days.day)
    ) order by days.day), '[]'::jsonb) as payload
    from days
  )
  select jsonb_build_object(
    'cumprimentoStatus', status_cumprimento.payload,
    'qualidadeStatus', status_qualidade.payload,
    'points', points.payload,
    'total', (select count(*) from accessible),
    'overdue', (
      select count(*)
      from accessible
      where prazo_fatal is not null
        and prazo_fatal < current_date
        and coalesce(cumprimento_status::text, '') <> 'ENTREGUE'
    )
  )
  from status_cumprimento, status_qualidade, points;
$$;

create or replace function public.tutela_process_duplicates(tutela_id_arg uuid)
returns table(
  id uuid,
  legacy_id_tutela text,
  processo text,
  data_chegada date,
  envio_bcc date,
  autor text,
  cpf_cnpj text,
  uc text,
  municipio_raw text,
  obf text,
  prioridade text,
  responsavel_cumprimento text,
  responsavel_qualidade text,
  cumprimento_status public.sentence_status,
  qualidade_status public.sentence_status,
  cumprimento_data date,
  qualidade_data date,
  data_ultimo_evento date,
  is_current boolean,
  event_count bigint,
  order_total bigint,
  order_open bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with current_row as (
    select *
    from public.tutelas t
    where t.id = tutela_id_arg
      and public.can_access_tutela(t)
  ),
  rows as (
    select t.*
    from public.tutelas t
    join current_row c on c.processo = t.processo
  )
  select
    rows.id,
    rows.legacy_id_tutela,
    rows.processo,
    rows.data_chegada,
    rows.envio_bcc,
    rows.autor,
    rows.cpf_cnpj,
    rows.uc,
    rows.municipio_raw,
    rows.obf,
    rows.prioridade,
    rows.responsavel_cumprimento,
    rows.responsavel_qualidade,
    rows.cumprimento_status,
    rows.qualidade_status,
    rows.cumprimento_data,
    rows.qualidade_data,
    rows.data_ultimo_evento,
    rows.id = tutela_id_arg,
    (select count(*) from public.tutela_events e where e.tutela_id = rows.id)::bigint,
    coalesce(summary.total_orders, 0),
    coalesce(summary.open_orders, 0)
  from rows
  left join public.salesforce_order_process_summaries summary
    on summary.processo = rows.processo
  order by rows.data_ultimo_evento desc nulls last, rows.id;
$$;

create or replace function public.assign_tutela_responsible_bulk(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'ALL',
  q_arg text default null,
  responsible_arg text default null,
  target_responsible_arg text default null,
  tutela_ids_arg uuid[] default null
)
returns table(updated_count bigint, skipped_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_total bigint := 0;
  changed_total bigint := 0;
  next_status public.sentence_status := case
    when nullif(trim(coalesce(target_responsible_arg, '')), '') is null then 'ESTOQUE'::public.sentence_status
    else 'EM ANDAMENTO'::public.sentence_status
  end;
begin
  if not public.is_manager() then
    raise exception 'Apenas administradores e gestores ativos podem atribuir responsaveis.';
  end if;

  if stage_arg = 'CUMPRIMENTO'::public.workflow_stage then
    with candidates as (
      select t.id
      from public.tutelas t
      where (tutela_ids_arg is null or t.id = any(tutela_ids_arg))
        and (status_mode_arg = 'ALL' or t.cumprimento_status::text = status_mode_arg)
        and (nullif(trim(coalesce(responsible_arg, '')), '') is null or responsible_arg = 'ALL' or t.responsavel_cumprimento = responsible_arg)
        and (
          nullif(trim(coalesce(q_arg, '')), '') is null
          or upper(coalesce(t.processo, '') || ' ' || coalesce(t.autor, '') || ' ' || coalesce(t.cpf_cnpj, '') || ' ' || coalesce(t.uc, ''))
             like '%' || upper(q_arg) || '%'
        )
    ),
    updated as (
      update public.tutelas t
         set responsavel_cumprimento = nullif(trim(coalesce(target_responsible_arg, '')), ''),
             cumprimento_status = next_status,
             cumprimento_base_status = next_status
        from candidates c
       where t.id = c.id
         and t.cumprimento_status in ('ESTOQUE'::public.sentence_status, 'EM ANDAMENTO'::public.sentence_status)
       returning t.id
    )
    select (select count(*) from candidates), (select count(*) from updated)
      into target_total, changed_total;
  else
    with candidates as (
      select t.id
      from public.tutelas t
      where t.cumprimento_status = 'ENTREGUE'::public.sentence_status
        and (tutela_ids_arg is null or t.id = any(tutela_ids_arg))
        and (status_mode_arg = 'ALL' or t.qualidade_status::text = status_mode_arg)
        and (nullif(trim(coalesce(responsible_arg, '')), '') is null or responsible_arg = 'ALL' or t.responsavel_qualidade = responsible_arg)
        and (
          nullif(trim(coalesce(q_arg, '')), '') is null
          or upper(coalesce(t.processo, '') || ' ' || coalesce(t.autor, '') || ' ' || coalesce(t.cpf_cnpj, '') || ' ' || coalesce(t.uc, ''))
             like '%' || upper(q_arg) || '%'
        )
    ),
    updated as (
      update public.tutelas t
         set responsavel_qualidade = nullif(trim(coalesce(target_responsible_arg, '')), ''),
             qualidade_status = next_status,
             qualidade_base_status = next_status
        from candidates c
       where t.id = c.id
         and t.qualidade_status in ('ESTOQUE'::public.sentence_status, 'EM ANDAMENTO'::public.sentence_status)
       returning t.id
    )
    select (select count(*) from candidates), (select count(*) from updated)
      into target_total, changed_total;
  end if;

  return query select changed_total, greatest(target_total - changed_total, 0);
end;
$$;

grant execute on function public.tutela_operational_queue_summary(public.workflow_stage, text, text) to authenticated;
grant execute on function public.tutela_operational_queue_items(public.workflow_stage, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.tutela_dashboard_metrics() to authenticated;
grant execute on function public.tutela_process_duplicates(uuid) to authenticated;
grant execute on function public.assign_tutela_responsible_bulk(public.workflow_stage, text, text, text, text, uuid[]) to authenticated;

drop policy if exists salesforce_orders_select_by_sentence on public.salesforce_orders;
create policy salesforce_orders_select_by_sentence on public.salesforce_orders
for select using (
  exists (
    select 1
    from public.sentences s
    where s.processo = salesforce_orders.processo
      and public.can_access_sentence(s)
  )
  or exists (
    select 1
    from public.tutelas t
    where t.processo = salesforce_orders.processo
      and public.can_access_tutela(t)
  )
);

drop policy if exists salesforce_order_process_summaries_select_by_sentence on public.salesforce_order_process_summaries;
create policy salesforce_order_process_summaries_select_by_sentence on public.salesforce_order_process_summaries
for select using (
  exists (
    select 1
    from public.sentences s
    where s.processo = salesforce_order_process_summaries.processo
      and public.can_access_sentence(s)
  )
  or exists (
    select 1
    from public.tutelas t
    where t.processo = salesforce_order_process_summaries.processo
      and public.can_access_tutela(t)
  )
);

analyze public.tutelas;
analyze public.tutela_events;
;
