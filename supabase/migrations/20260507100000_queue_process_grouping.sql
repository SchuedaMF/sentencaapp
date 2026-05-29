create or replace function public.tutela_operational_queue_items_v5(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'ACTIVE',
  indicator_arg text default 'ALL',
  date_filters_arg jsonb default '[]'::jsonb,
  status_filters_arg jsonb default '[]'::jsonb,
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
  duplicate_count bigint,
  process_group_count bigint,
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
      upper(coalesce(nullif(trim(indicator_arg), ''), 'ALL')) as indicator_filter,
      case
        when sort_key_arg in ('responsible', 'processo', 'status', 'stage_date', 'data_ultimo_evento', 'origem', 'sla', 'order_summary') then sort_key_arg
        else null
      end as sort_key,
      case when lower(coalesce(sort_direction_arg, 'asc')) = 'desc' then 'desc' else 'asc' end as sort_direction
  ),
  duplicate_counts as (
    select processo, count(*)::bigint as duplicate_count
      from public.tutelas
     group by processo
  ),
  accessible_process_counts as (
    select t.processo, count(*)::bigint as process_group_count
      from public.tutelas t
     where public.can_access_tutela(t)
     group by t.processo
  ),
  scoped as (
    select
      t.*,
      coalesce(dc.duplicate_count, 1) as duplicate_count,
      coalesce(apc.process_group_count, 1) as process_group_count,
      case when stage_arg = 'CUMPRIMENTO' then t.cumprimento_status else t.qualidade_status end as queue_status,
      public.queue_status_rank(case when stage_arg = 'CUMPRIMENTO' then t.cumprimento_status else t.qualidade_status end) as queue_rank,
      case when stage_arg = 'CUMPRIMENTO' then t.responsavel_cumprimento else t.responsavel_qualidade end as queue_responsible,
      case when stage_arg = 'CUMPRIMENTO' then t.envio_bcc else t.cumprimento_data end as stage_date,
      case when stage_arg = 'CUMPRIMENTO' then t.prazo_fatal else t.data_ultimo_evento end as sla_date
    from public.tutelas t
    left join duplicate_counts dc on dc.processo = t.processo
    left join accessible_process_counts apc on apc.processo = t.processo
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
    where public.tutela_queue_status_matches(status_mode_arg, scoped.queue_status)
      and public.tutela_queue_status_filters_match(status_filters_arg, scoped.cumprimento_status, scoped.qualidade_status)
      and public.tutela_indicator_matches(p.indicator_filter, scoped.obf, scoped.duplicate_count)
      and public.tutela_queue_date_filters_match(date_filters_arg, scoped.envio_bcc, scoped.tratado, scoped.cumprimento_data, scoped.qualidade_data)
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
  ranked as (
    select
      sort_ready.*,
      row_number() over (
        partition by coalesce(sort_ready.processo, sort_ready.id::text)
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
      ) as process_rank
    from sort_ready
    cross join params p
  ),
  group_ready as (
    select *
    from ranked
    where process_rank = 1
  ),
  ordered as (
    select
      group_ready.*,
      count(*) over () as total_rows
    from group_ready
    cross join params p
    order by
      case when p.sort_key is null then group_ready.queue_rank end asc nulls last,
      case when p.sort_key is null then coalesce(group_ready.data_ultimo_evento, '9999-12-31'::date) end asc nulls last,
      case when p.sort_key = 'responsible' and p.sort_direction = 'asc' then group_ready.queue_responsible end asc nulls last,
      case when p.sort_key = 'responsible' and p.sort_direction = 'desc' then group_ready.queue_responsible end desc nulls last,
      case when p.sort_key = 'processo' and p.sort_direction = 'asc' then group_ready.processo end asc nulls last,
      case when p.sort_key = 'processo' and p.sort_direction = 'desc' then group_ready.processo end desc nulls last,
      case when p.sort_key = 'status' and p.sort_direction = 'asc' then group_ready.queue_rank end asc nulls last,
      case when p.sort_key = 'status' and p.sort_direction = 'desc' then group_ready.queue_rank end desc nulls last,
      case when p.sort_key = 'stage_date' and p.sort_direction = 'asc' then group_ready.stage_date end asc nulls last,
      case when p.sort_key = 'stage_date' and p.sort_direction = 'desc' then group_ready.stage_date end desc nulls last,
      case when p.sort_key = 'data_ultimo_evento' and p.sort_direction = 'asc' then group_ready.data_ultimo_evento end asc nulls last,
      case when p.sort_key = 'data_ultimo_evento' and p.sort_direction = 'desc' then group_ready.data_ultimo_evento end desc nulls last,
      case when p.sort_key = 'origem' and p.sort_direction = 'asc' then group_ready.origem_normalized end asc nulls last,
      case when p.sort_key = 'origem' and p.sort_direction = 'desc' then group_ready.origem_normalized end desc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'asc' then group_ready.sla_date end asc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'desc' then group_ready.sla_date end desc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then group_ready.sort_order_total end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then group_ready.sort_order_total end desc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then group_ready.sort_order_open end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then group_ready.sort_order_open end desc nulls last,
      group_ready.id asc
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
    ordered.duplicate_count,
    ordered.process_group_count,
    coalesce(summary.total_orders, 0),
    coalesce(summary.open_orders, 0),
    coalesce(summary.closed_orders, 0),
    coalesce(summary.unknown_orders, 0)
  from ordered
  left join public.salesforce_order_process_summaries summary
    on summary.processo = ordered.processo;
$$;
grant execute on function public.tutela_operational_queue_items_v5(public.workflow_stage, text, text, jsonb, jsonb, text, text, text, integer, text, text) to authenticated;
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
    where public.can_access_tutela(t)
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
