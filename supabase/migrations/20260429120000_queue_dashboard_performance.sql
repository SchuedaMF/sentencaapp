-- Incremental performance work for the operational queue and dashboard.
-- Keeps operational_queue_items_v2 in place and moves the app to v3.

create table if not exists public.salesforce_order_process_summaries (
  processo text primary key,
  total_orders bigint not null default 0,
  open_orders bigint not null default 0,
  closed_orders bigint not null default 0,
  unknown_orders bigint not null default 0,
  latest_imported_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists salesforce_order_process_summaries_order_sort_idx
  on public.salesforce_order_process_summaries (total_orders desc, open_orders desc, processo);
alter table public.salesforce_order_process_summaries enable row level security;
grant select on public.salesforce_order_process_summaries to authenticated;
grant all on public.salesforce_order_process_summaries to service_role;
drop policy if exists salesforce_order_process_summaries_select_by_sentence on public.salesforce_order_process_summaries;
create policy salesforce_order_process_summaries_select_by_sentence on public.salesforce_order_process_summaries
for select using (
  exists (
    select 1
    from public.sentences s
    where s.processo = salesforce_order_process_summaries.processo
      and public.can_access_sentence(s)
  )
);
create or replace function public.refresh_salesforce_order_process_summaries()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_count bigint := 0;
begin
  delete from public.salesforce_order_process_summaries;

  with order_rows as (
    select
      so.processo,
      coalesce(
        nullif(trim(so.order_key), ''),
        nullif(trim(so.order_number), ''),
        nullif(trim(so.synergia_order_number), ''),
        case when so.salesforce_case_number is not null then 'caso-' || so.salesforce_case_number else 'linha-' || so.import_row_number::text end
      ) as order_group_key,
      bool_or(so.is_open or so.status_bucket = 'open') as is_open,
      bool_or(so.status_bucket = 'unknown') as is_unknown,
      max(so.created_at) as latest_imported_at
    from public.salesforce_orders so
    where so.is_latest
      and so.processo is not null
    group by so.processo, order_group_key
  ),
  process_rows as (
    select
      order_rows.processo,
      count(*)::bigint as total_orders,
      count(*) filter (where order_rows.is_open)::bigint as open_orders,
      count(*) filter (where not order_rows.is_open and not order_rows.is_unknown)::bigint as closed_orders,
      count(*) filter (where not order_rows.is_open and order_rows.is_unknown)::bigint as unknown_orders,
      max(order_rows.latest_imported_at) as latest_imported_at
    from order_rows
    group by order_rows.processo
  )
  insert into public.salesforce_order_process_summaries (
    processo,
    total_orders,
    open_orders,
    closed_orders,
    unknown_orders,
    latest_imported_at,
    updated_at
  )
  select
    processo,
    total_orders,
    open_orders,
    closed_orders,
    unknown_orders,
    latest_imported_at,
    now()
  from process_rows;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;
revoke all on function public.refresh_salesforce_order_process_summaries() from public, anon, authenticated;
grant execute on function public.refresh_salesforce_order_process_summaries() to service_role;
select public.refresh_salesforce_order_process_summaries();
create index if not exists sentences_cumprimento_stage_date_sort_idx
  on public.sentences (cumprimento_status, envio_bcc desc nulls last, id);
create index if not exists sentences_cumprimento_stage_date_responsavel_sort_idx
  on public.sentences (responsavel_cumprimento, cumprimento_status, envio_bcc desc nulls last, id);
create index if not exists sentences_qualidade_stage_date_sort_idx
  on public.sentences (qualidade_status, cumprimento_data desc nulls last, id)
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;
create index if not exists sentences_qualidade_stage_date_responsavel_sort_idx
  on public.sentences (responsavel_qualidade, qualidade_status, cumprimento_data desc nulls last, id)
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;
drop function if exists public.operational_queue_items_v3(public.workflow_stage, text, text, text, text, integer, text, text);
create function public.operational_queue_items_v3(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'PRIORITY',
  responsible_arg text default null,
  q_arg text default null,
  cursor_arg text default null,
  page_size_arg integer default 50,
  sort_key_arg text default null,
  sort_direction_arg text default 'asc'
)
returns table(
  id uuid,
  processo text,
  envio_bcc date,
  origem_raw text,
  origem_normalized text,
  tratado date,
  tipo_justica_raw text,
  cpf_cnpj text,
  responsavel_cumprimento text,
  responsavel_qualidade text,
  cumprimento_status public.sentence_status,
  qualidade_status public.sentence_status,
  cumprimento_data date,
  qualidade_data date,
  data_ultimo_evento date,
  next_cursor text,
  order_total bigint,
  order_open bigint,
  order_closed bigint,
  order_unknown bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with raw_params as (
    select
      coalesce(cursor_arg, '') as cursor_value,
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term,
      least(greatest(coalesce(page_size_arg, 50), 1), 100) as page_limit,
      case
        when sort_key_arg in ('responsible', 'processo', 'status', 'stage_date', 'data_ultimo_evento', 'origem', 'sla') then sort_key_arg
        when sort_key_arg = 'order_summary' and stage_arg = 'QUALIDADE' then sort_key_arg
        else null
      end as sort_key,
      case when lower(coalesce(sort_direction_arg, 'asc')) = 'desc' then 'desc' else 'asc' end as sort_direction
  ),
  params as (
    select
      *,
      cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' as is_keyset_cursor,
      case
        when cursor_value ~ '^[0-9]+$' then least(cursor_value::integer, 100000)
        when cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then least(split_part(cursor_value, '|', 5)::integer, 100000)
        else 0
      end as cursor_offset,
      case
        when cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then split_part(cursor_value, '|', 2)::smallint
        else null::smallint
      end as cursor_rank,
      case
        when cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then split_part(cursor_value, '|', 3)::date
        else null::date
      end as cursor_date,
      case
        when cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then split_part(cursor_value, '|', 4)::uuid
        else null::uuid
      end as cursor_id
    from raw_params
  ),
  scoped as (
    select
      s.id,
      s.processo,
      s.envio_bcc,
      s.origem_raw,
      s.origem_normalized,
      s.tratado,
      s.tipo_justica_raw,
      s.cpf_cnpj,
      s.autor,
      s.uc,
      s.responsavel_cumprimento,
      s.responsavel_qualidade,
      s.cumprimento_status,
      s.qualidade_status,
      s.cumprimento_data,
      s.qualidade_data,
      s.data_ultimo_evento,
      case when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status else s.qualidade_status end as queue_status,
      public.queue_status_rank(case when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status else s.qualidade_status end) as queue_rank,
      coalesce(s.data_ultimo_evento, '9999-12-31'::date) as queue_date,
      case when stage_arg = 'CUMPRIMENTO' then s.responsavel_cumprimento else s.responsavel_qualidade end as responsible_value,
      case when stage_arg = 'CUMPRIMENTO' then s.envio_bcc else s.cumprimento_data end as stage_date,
      case when stage_arg = 'CUMPRIMENTO' then s.envio_bcc else s.data_ultimo_evento end as sla_date
    from public.sentences s
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (
        p.is_manager
        or upper(coalesce(s.responsavel_cumprimento, '')) = upper(p.profile_name)
      )
      and (
        not p.is_manager
        or p.responsible_filter is null
        or p.responsible_filter = 'ALL'
        or s.responsavel_cumprimento = p.responsible_filter
      )
    )
    or (
      stage_arg = 'QUALIDADE'
      and s.cumprimento_status = 'ENTREGUE'::public.sentence_status
      and (
        p.is_manager
        or upper(coalesce(s.responsavel_qualidade, '')) = upper(p.profile_name)
      )
      and (
        not p.is_manager
        or p.responsible_filter is null
        or p.responsible_filter = 'ALL'
        or s.responsavel_qualidade = p.responsible_filter
      )
    )
  ),
  filtered as (
    select scoped.*
    from scoped
    cross join params p
    where (
      status_mode_arg = 'ALL'
      or (status_mode_arg = 'PRIORITY' and scoped.queue_status in ('EM ANDAMENTO', 'PENDENTE'))
      or scoped.queue_status::text = status_mode_arg
    )
    and (
      p.search_term is null
      or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, '')) like '%' || upper(p.search_term) || '%'
    )
    and (
      p.sort_key is not null
      or not p.is_keyset_cursor
      or (scoped.queue_rank, scoped.queue_date, scoped.id) > (p.cursor_rank, p.cursor_date, p.cursor_id)
    )
  ),
  sort_ready as (
    select
      filtered.*,
      coalesce(sort_summary.total_orders, 0) as sort_order_total,
      coalesce(sort_summary.open_orders, 0) as sort_order_open
    from filtered
    cross join params p
    left join public.salesforce_order_process_summaries sort_summary
      on p.sort_key = 'order_summary'
     and sort_summary.processo = filtered.processo
  ),
  limited as (
    select sort_ready.*
    from sort_ready
    cross join params p
    order by
      case when p.sort_key is null then sort_ready.queue_rank end asc nulls last,
      case when p.sort_key is null then sort_ready.queue_date end asc nulls last,

      case when p.sort_key = 'responsible' and p.sort_direction = 'asc' then sort_ready.responsible_value end asc nulls last,
      case when p.sort_key = 'responsible' and p.sort_direction = 'desc' then sort_ready.responsible_value end desc nulls last,
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
      case when p.sort_key = 'sla' and p.sort_direction = 'asc' then sort_ready.sla_date end desc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'desc' then sort_ready.sla_date end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then sort_ready.sort_order_total end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then sort_ready.sort_order_total end desc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then sort_ready.sort_order_open end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then sort_ready.sort_order_open end desc nulls last,
      sort_ready.id asc
    offset (select case when sort_key is null and is_keyset_cursor then 0 else cursor_offset end from params)
    limit (select page_limit + 1 from params)
  ),
  numbered as (
    select
      limited.*,
      row_number() over () as row_index
    from limited
  ),
  meta as (
    select count(*) > (select page_limit from params) as has_next
    from numbered
  ),
  last_visible as (
    select numbered.*
    from numbered
    cross join params p
    where numbered.row_index <= p.page_limit
    order by numbered.row_index desc
    limit 1
  ),
  cursor_out as (
    select case
      when meta.has_next and (select sort_key from params) is null then concat(
        'k|',
        last_visible.queue_rank,
        '|',
        to_char(last_visible.queue_date, 'YYYY-MM-DD'),
        '|',
        last_visible.id,
        '|',
        (select cursor_offset + page_limit from params)
      )
      when meta.has_next then (select (cursor_offset + page_limit)::text from params)
      else null
    end as value
    from meta
    left join last_visible on true
  )
  select
    numbered.id,
    numbered.processo,
    numbered.envio_bcc,
    numbered.origem_raw,
    numbered.origem_normalized,
    numbered.tratado,
    numbered.tipo_justica_raw,
    numbered.cpf_cnpj,
    numbered.responsavel_cumprimento,
    numbered.responsavel_qualidade,
    numbered.cumprimento_status,
    numbered.qualidade_status,
    numbered.cumprimento_data,
    numbered.qualidade_data,
    numbered.data_ultimo_evento,
    cursor_out.value as next_cursor,
    coalesce(display_summary.total_orders, 0) as order_total,
    coalesce(display_summary.open_orders, 0) as order_open,
    coalesce(display_summary.closed_orders, 0) as order_closed,
    coalesce(display_summary.unknown_orders, 0) as order_unknown
  from numbered
  cross join params p
  cross join cursor_out
  left join public.salesforce_order_process_summaries display_summary
    on display_summary.processo = numbered.processo
  where numbered.row_index <= p.page_limit
  order by numbered.row_index;
$$;
grant execute on function public.operational_queue_items_v3(public.workflow_stage, text, text, text, text, integer, text, text) to authenticated;
drop function if exists public.dashboard_production_metrics(date);
create function public.dashboard_production_metrics(today_arg date default current_date)
returns table(
  person_key text,
  name text,
  is_current_user boolean,
  etapa public.workflow_stage,
  today_count bigint,
  month_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      coalesce((select public.current_profile_name()), '') as profile_name,
      coalesce((select public.is_manager()), false) as can_see_names,
      (date_trunc('month', today_arg::timestamp))::date as month_start
  ),
  event_rows as (
    select
      coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), nullif(trim(e.responsavel), '')) as responsible_name,
      e.etapa,
      e.data_evento
    from public.sentence_events e
    left join public.profiles p on p.id = e.created_by
    cross join params
    where e.etapa in ('CUMPRIMENTO', 'QUALIDADE')
      and e.data_evento >= params.month_start
      and e.data_evento <= today_arg
  ),
  grouped as (
    select
      event_rows.responsible_name,
      event_rows.etapa,
      count(*) filter (where event_rows.data_evento = today_arg)::bigint as today_count,
      count(*)::bigint as month_count
    from event_rows
    where event_rows.responsible_name is not null
    group by event_rows.responsible_name, event_rows.etapa
  )
  select
    md5(upper(grouped.responsible_name)) as person_key,
    case
      when params.can_see_names or upper(grouped.responsible_name) = upper(params.profile_name) then grouped.responsible_name
      else null
    end as name,
    upper(grouped.responsible_name) = upper(params.profile_name) as is_current_user,
    grouped.etapa,
    grouped.today_count,
    grouped.month_count
  from grouped
  cross join params;
$$;
revoke all on function public.dashboard_production_metrics(date) from public, anon;
grant execute on function public.dashboard_production_metrics(date) to authenticated;
analyze public.sentences;
analyze public.salesforce_orders;
analyze public.salesforce_order_process_summaries;
