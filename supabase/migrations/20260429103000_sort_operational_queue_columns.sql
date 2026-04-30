-- Add server-side sorting for clickable operational queue headers.

drop function if exists public.operational_queue_items_v2(public.workflow_stage, text, text, text, text, integer, text, text);
drop function if exists public.operational_queue_items_v2(public.workflow_stage, text, text, text, text, integer);

create function public.operational_queue_items_v2(
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
  total_count bigint
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
  order_rows as (
    select
      so.processo,
      coalesce(
        nullif(trim(so.order_key), ''),
        nullif(trim(so.order_number), ''),
        nullif(trim(so.synergia_order_number), ''),
        case when so.salesforce_case_number is not null then 'caso-' || so.salesforce_case_number else 'linha-' || so.import_row_number::text end
      ) as order_group_key,
      bool_or(so.is_open or so.status_bucket = 'open') as is_open,
      bool_or(so.status_bucket = 'unknown') as is_unknown
    from public.salesforce_orders so
    where so.is_latest
      and so.processo is not null
    group by so.processo, order_group_key
  ),
  order_counts as (
    select
      order_rows.processo,
      count(*)::bigint as total_orders,
      count(*) filter (where order_rows.is_open)::bigint as open_orders,
      count(*) filter (where not order_rows.is_open and order_rows.is_unknown)::bigint as unknown_orders
    from order_rows
    group by order_rows.processo
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
      case when stage_arg = 'CUMPRIMENTO' then s.envio_bcc else s.data_ultimo_evento end as sla_date,
      coalesce(oc.total_orders, 0) as order_total,
      coalesce(oc.open_orders, 0) as order_open,
      coalesce(oc.unknown_orders, 0) as order_unknown
    from public.sentences s
    left join order_counts oc on oc.processo = s.processo
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
  totals as (
    select count(*)::bigint as item_count from filtered
  ),
  limited as (
    select filtered.*
    from filtered
    cross join params p
    order by
      case when p.sort_key is null then filtered.queue_rank end asc nulls last,
      case when p.sort_key is null then filtered.queue_date end asc nulls last,

      case when p.sort_key = 'responsible' and p.sort_direction = 'asc' then filtered.responsible_value end asc nulls last,
      case when p.sort_key = 'responsible' and p.sort_direction = 'desc' then filtered.responsible_value end desc nulls last,
      case when p.sort_key = 'processo' and p.sort_direction = 'asc' then filtered.processo end asc nulls last,
      case when p.sort_key = 'processo' and p.sort_direction = 'desc' then filtered.processo end desc nulls last,
      case when p.sort_key = 'status' and p.sort_direction = 'asc' then filtered.queue_rank end asc nulls last,
      case when p.sort_key = 'status' and p.sort_direction = 'desc' then filtered.queue_rank end desc nulls last,
      case when p.sort_key = 'stage_date' and p.sort_direction = 'asc' then filtered.stage_date end asc nulls last,
      case when p.sort_key = 'stage_date' and p.sort_direction = 'desc' then filtered.stage_date end desc nulls last,
      case when p.sort_key = 'data_ultimo_evento' and p.sort_direction = 'asc' then filtered.data_ultimo_evento end asc nulls last,
      case when p.sort_key = 'data_ultimo_evento' and p.sort_direction = 'desc' then filtered.data_ultimo_evento end desc nulls last,
      case when p.sort_key = 'origem' and p.sort_direction = 'asc' then filtered.origem_normalized end asc nulls last,
      case when p.sort_key = 'origem' and p.sort_direction = 'desc' then filtered.origem_normalized end desc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'asc' then filtered.sla_date end desc nulls last,
      case when p.sort_key = 'sla' and p.sort_direction = 'desc' then filtered.sla_date end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then filtered.order_total end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then filtered.order_total end desc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'asc' then filtered.order_open end asc nulls last,
      case when p.sort_key = 'order_summary' and p.sort_direction = 'desc' then filtered.order_open end desc nulls last,
      filtered.id asc
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
    totals.item_count as total_count
  from numbered
  cross join params p
  cross join cursor_out
  cross join totals
  where numbered.row_index <= p.page_limit
  order by numbered.row_index;
$$;

drop function if exists public.operational_queue_items(public.workflow_stage, text, text, text, text, integer, text, text);
drop function if exists public.operational_queue_items(public.workflow_stage, text, text, text, text, integer);

create function public.operational_queue_items(
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
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    q.id,
    q.processo,
    q.envio_bcc,
    q.origem_raw,
    q.origem_normalized,
    q.tratado,
    q.tipo_justica_raw,
    q.cpf_cnpj,
    q.responsavel_cumprimento,
    q.responsavel_qualidade,
    q.cumprimento_status,
    q.qualidade_status,
    q.cumprimento_data,
    q.qualidade_data,
    q.data_ultimo_evento,
    q.total_count
  from public.operational_queue_items_v2(
    stage_arg,
    status_mode_arg,
    responsible_arg,
    q_arg,
    cursor_arg,
    page_size_arg,
    sort_key_arg,
    sort_direction_arg
  ) q;
$$;

grant execute on function public.operational_queue_items_v2(public.workflow_stage, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.operational_queue_items(public.workflow_stage, text, text, text, text, integer, text, text) to authenticated;

analyze public.sentences;
analyze public.salesforce_orders;
