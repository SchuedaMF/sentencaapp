do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sentences'
       and column_name = 'pendencia'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sentences'
       and column_name = 'pendencia_base'
  ) then
    raise exception 'A migration current_sentence_pendencia deve ser aplicada antes das RPCs de fila/SLA.';
  end if;
end $$;

create index if not exists sentences_queue_cumprimento_pendencia_sla_idx
  on public.sentences (cumprimento_status, pendencia, tratado, data_ultimo_evento, id);

create index if not exists sentences_queue_cumprimento_resp_pendencia_sla_idx
  on public.sentences (upper(coalesce(responsavel_cumprimento, '')), cumprimento_status, pendencia, tratado, data_ultimo_evento, id);

create index if not exists sentences_queue_qualidade_pendencia_sla_idx
  on public.sentences (qualidade_status, pendencia, data_ultimo_evento, id);

create index if not exists sentences_queue_qualidade_resp_pendencia_sla_idx
  on public.sentences (upper(coalesce(responsavel_qualidade, '')), qualidade_status, pendencia, data_ultimo_evento, id);

create index if not exists sentences_queue_qualidade_ready_pendencia_sla_idx
  on public.sentences (qualidade_status, pendencia, data_ultimo_evento, id)
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;

create index if not exists sentences_queue_qualidade_ready_resp_pendencia_sla_idx
  on public.sentences (upper(coalesce(responsavel_qualidade, '')), qualidade_status, pendencia, data_ultimo_evento, id)
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;

create or replace function public.queue_sla_bucket_matches(
  stage_arg public.workflow_stage,
  bucket_arg text,
  tratado_arg date,
  data_ultimo_evento_arg date
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(bucket_arg, '')), '') is null then true
    when stage_arg = 'QUALIDADE'::public.workflow_stage then
      case bucket_arg
        when '0_7' then data_ultimo_evento_arg >= current_date - 7 and data_ultimo_evento_arg <= current_date
        when '8_14' then data_ultimo_evento_arg >= current_date - 14 and data_ultimo_evento_arg <= current_date - 8
        when '15_30' then data_ultimo_evento_arg >= current_date - 30 and data_ultimo_evento_arg <= current_date - 15
        when '31_60' then data_ultimo_evento_arg >= current_date - 60 and data_ultimo_evento_arg <= current_date - 31
        when '61_PLUS' then data_ultimo_evento_arg <= current_date - 61
        else true
      end
    else
      case bucket_arg
        when '0' then tratado_arg = current_date
        when '1' then tratado_arg = current_date - 1
        when '2' then tratado_arg = current_date - 2
        when '3' then tratado_arg = current_date - 3
        when '4' then tratado_arg = current_date - 4
        when '5_PLUS' then tratado_arg <= current_date - 5
        else true
      end
  end;
$$;

create or replace function public.queue_pendencia_filter_matches(
  status_arg public.sentence_status,
  pendencia_value text,
  pendencia_arg text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(pendencia_arg, '')), '') is null then true
    when status_arg is distinct from 'PENDENTE'::public.sentence_status then true
    when pendencia_arg = 'SEM_TIPO' then pendencia_value is null
    else pendencia_value = pendencia_arg
  end;
$$;

create or replace function public.operational_queue_summary_v2(
  stage_arg public.workflow_stage default 'CUMPRIMENTO',
  responsible_arg text default null,
  q_arg text default null,
  sla_bucket_arg text default null,
  view_arg text default 'operational'
)
returns table(stage public.workflow_stage, kind text, value text, item_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with raw_params as (
    select
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term,
      nullif(trim(coalesce(sla_bucket_arg, '')), '') as sla_bucket,
      case when view_arg = 'dashboard-status' then 'dashboard-status' else 'operational' end as queue_view
  ),
  params as (
    select
      raw_params.*,
      case
        when raw_params.responsible_filter = 'ALL' then null
        when raw_params.responsible_filter is not null then raw_params.responsible_filter
        when not raw_params.is_manager then raw_params.profile_name
        else null
      end as status_responsible_filter
    from raw_params
  ),
  scoped as (
    select
      stage_arg as stage,
      case
        when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status
        else s.qualidade_status
      end as status_value,
      case
        when stage_arg = 'CUMPRIMENTO' then s.responsavel_cumprimento
        else s.responsavel_qualidade
      end as responsible_value,
      s.pendencia,
      s.processo,
      s.autor,
      s.cpf_cnpj,
      s.uc,
      s.tratado,
      s.data_ultimo_evento
    from public.sentences s
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
    )
    or (
      stage_arg = 'QUALIDADE'
      and (
        p.queue_view = 'dashboard-status'
        or s.cumprimento_status = 'ENTREGUE'::public.sentence_status
      )
    )
  ),
  searched as (
    select scoped.*
    from scoped
    cross join params p
    where public.queue_sla_bucket_matches(stage_arg, p.sla_bucket, scoped.tratado, scoped.data_ultimo_evento)
      and (
        p.search_term is null
        or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, '')) like '%' || upper(p.search_term) || '%'
      )
  )
  select stage, 'status'::text as kind, status_value::text as value, count(*)::bigint as item_count
    from searched
    cross join params p
   where status_value is not null
     and (
       p.queue_view <> 'dashboard-status'
       or status_value <> 'ENTREGUE'::public.sentence_status
     )
     and (
       p.status_responsible_filter is null
       or upper(coalesce(responsible_value, '')) = upper(p.status_responsible_filter)
     )
   group by stage, status_value

  union all

  select stage, 'responsible'::text as kind, responsible_value as value, count(*)::bigint as item_count
    from searched
    cross join params p
   where responsible_value is not null
     and (
       p.queue_view <> 'dashboard-status'
       or status_value <> 'ENTREGUE'::public.sentence_status
     )
   group by stage, responsible_value

  union all

  select stage, 'pendencia'::text as kind, coalesce(pendencia, 'SEM_TIPO') as value, count(*)::bigint as item_count
    from searched
    cross join params p
   where status_value = 'PENDENTE'::public.sentence_status
     and (
       p.status_responsible_filter is null
       or upper(coalesce(responsible_value, '')) = upper(p.status_responsible_filter)
     )
   group by stage, coalesce(pendencia, 'SEM_TIPO');
$$;

create or replace function public.operational_queue_sla_counts_v1(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'PRIORITY',
  responsible_arg text default null,
  q_arg text default null,
  pendencia_arg text default null,
  view_arg text default 'operational'
)
returns table(bucket text, item_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with raw_params as (
    select
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term,
      nullif(trim(coalesce(pendencia_arg, '')), '') as pendencia_filter,
      case when view_arg = 'dashboard-status' then 'dashboard-status' else 'operational' end as queue_view
  ),
  params as (
    select
      raw_params.*,
      case
        when raw_params.responsible_filter = 'ALL' then null
        when raw_params.responsible_filter is not null then raw_params.responsible_filter
        when not raw_params.is_manager then raw_params.profile_name
        else null
      end as queue_responsible_filter
    from raw_params
  ),
  buckets as (
    select *
    from (
      values
        ('CUMPRIMENTO'::public.workflow_stage, '0'::text, 1),
        ('CUMPRIMENTO'::public.workflow_stage, '1'::text, 2),
        ('CUMPRIMENTO'::public.workflow_stage, '2'::text, 3),
        ('CUMPRIMENTO'::public.workflow_stage, '3'::text, 4),
        ('CUMPRIMENTO'::public.workflow_stage, '4'::text, 5),
        ('CUMPRIMENTO'::public.workflow_stage, '5_PLUS'::text, 6),
        ('QUALIDADE'::public.workflow_stage, '0_7'::text, 1),
        ('QUALIDADE'::public.workflow_stage, '8_14'::text, 2),
        ('QUALIDADE'::public.workflow_stage, '15_30'::text, 3),
        ('QUALIDADE'::public.workflow_stage, '31_60'::text, 4),
        ('QUALIDADE'::public.workflow_stage, '61_PLUS'::text, 5)
    ) as bucket_values(stage, bucket, sort_order)
    where bucket_values.stage = stage_arg
  ),
  scoped as (
    select
      s.id,
      s.processo,
      s.autor,
      s.cpf_cnpj,
      s.uc,
      s.tratado,
      s.data_ultimo_evento,
      s.pendencia,
      case when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status else s.qualidade_status end as queue_status,
      case when stage_arg = 'CUMPRIMENTO' then s.responsavel_cumprimento else s.responsavel_qualidade end as responsible_value
    from public.sentences s
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (
        p.queue_responsible_filter is null
        or upper(coalesce(s.responsavel_cumprimento, '')) = upper(p.queue_responsible_filter)
      )
    )
    or (
      stage_arg = 'QUALIDADE'
      and (
        p.queue_view = 'dashboard-status'
        or s.cumprimento_status = 'ENTREGUE'::public.sentence_status
      )
      and (
        p.queue_responsible_filter is null
        or upper(coalesce(s.responsavel_qualidade, '')) = upper(p.queue_responsible_filter)
      )
    )
  ),
  filtered as (
    select scoped.*
    from scoped
    cross join params p
    where (
      (
        p.queue_view = 'dashboard-status'
        and (
          (status_mode_arg = 'ALL' and scoped.queue_status <> 'ENTREGUE'::public.sentence_status)
          or (status_mode_arg = 'PRIORITY' and scoped.queue_status in ('EM ANDAMENTO', 'PENDENTE'))
          or scoped.queue_status::text = status_mode_arg
        )
      )
      or (
        p.queue_view <> 'dashboard-status'
        and (
          status_mode_arg = 'ALL'
          or (status_mode_arg = 'PRIORITY' and scoped.queue_status in ('EM ANDAMENTO', 'PENDENTE'))
          or scoped.queue_status::text = status_mode_arg
        )
      )
    )
    and (
      p.search_term is null
      or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, '')) like '%' || upper(p.search_term) || '%'
    )
    and public.queue_pendencia_filter_matches(scoped.queue_status, scoped.pendencia, p.pendencia_filter)
  )
  select buckets.bucket, count(filtered.id)::bigint as item_count
    from buckets
    left join filtered
      on public.queue_sla_bucket_matches(stage_arg, buckets.bucket, filtered.tratado, filtered.data_ultimo_evento)
   group by buckets.bucket, buckets.sort_order
   order by buckets.sort_order;
$$;

create or replace function public.operational_queue_items_v4(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'PRIORITY',
  responsible_arg text default null,
  q_arg text default null,
  cursor_arg text default null,
  page_size_arg integer default 50,
  sort_key_arg text default null,
  sort_direction_arg text default 'asc',
  sla_bucket_arg text default null,
  pendencia_arg text default null,
  view_arg text default 'operational'
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
  pendencia text,
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
      nullif(trim(coalesce(sla_bucket_arg, '')), '') as sla_bucket,
      nullif(trim(coalesce(pendencia_arg, '')), '') as pendencia_filter,
      case when view_arg = 'dashboard-status' then 'dashboard-status' else 'operational' end as queue_view,
      least(greatest(coalesce(page_size_arg, 50), 1), 100) as page_limit,
      case
        when sort_key_arg in ('responsible', 'processo', 'status', 'stage_date', 'data_ultimo_evento', 'origem', 'sla') then sort_key_arg
        when sort_key_arg in ('envio_bcc', 'order_summary') and stage_arg = 'QUALIDADE' then sort_key_arg
        else null
      end as sort_key,
      case when lower(coalesce(sort_direction_arg, 'asc')) = 'desc' then 'desc' else 'asc' end as sort_direction
  ),
  params as (
    select
      raw_params.*,
      raw_params.cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' as is_keyset_cursor,
      case
        when raw_params.cursor_value ~ '^[0-9]+$' then least(raw_params.cursor_value::integer, 100000)
        when raw_params.cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then least(split_part(raw_params.cursor_value, '|', 5)::integer, 100000)
        else 0
      end as cursor_offset,
      case
        when raw_params.cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then split_part(raw_params.cursor_value, '|', 2)::smallint
        else null::smallint
      end as cursor_rank,
      case
        when raw_params.cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then split_part(raw_params.cursor_value, '|', 3)::date
        else null::date
      end as cursor_date,
      case
        when raw_params.cursor_value ~ '^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$' then split_part(raw_params.cursor_value, '|', 4)::uuid
        else null::uuid
      end as cursor_id,
      case
        when raw_params.responsible_filter = 'ALL' then null
        when raw_params.responsible_filter is not null then raw_params.responsible_filter
        when not raw_params.is_manager then raw_params.profile_name
        else null
      end as queue_responsible_filter
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
      s.pendencia,
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
      case when stage_arg = 'CUMPRIMENTO' then s.tratado else s.data_ultimo_evento end as sla_date
    from public.sentences s
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (
        p.queue_responsible_filter is null
        or upper(coalesce(s.responsavel_cumprimento, '')) = upper(p.queue_responsible_filter)
      )
    )
    or (
      stage_arg = 'QUALIDADE'
      and (
        p.queue_view = 'dashboard-status'
        or s.cumprimento_status = 'ENTREGUE'::public.sentence_status
      )
      and (
        p.queue_responsible_filter is null
        or upper(coalesce(s.responsavel_qualidade, '')) = upper(p.queue_responsible_filter)
      )
    )
  ),
  filtered as (
    select scoped.*
    from scoped
    cross join params p
    where (
      (
        p.queue_view = 'dashboard-status'
        and (
          (status_mode_arg = 'ALL' and scoped.queue_status <> 'ENTREGUE'::public.sentence_status)
          or (status_mode_arg = 'PRIORITY' and scoped.queue_status in ('EM ANDAMENTO', 'PENDENTE'))
          or scoped.queue_status::text = status_mode_arg
        )
      )
      or (
        p.queue_view <> 'dashboard-status'
        and (
          status_mode_arg = 'ALL'
          or (status_mode_arg = 'PRIORITY' and scoped.queue_status in ('EM ANDAMENTO', 'PENDENTE'))
          or scoped.queue_status::text = status_mode_arg
        )
      )
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
    and public.queue_sla_bucket_matches(stage_arg, p.sla_bucket, scoped.tratado, scoped.data_ultimo_evento)
    and public.queue_pendencia_filter_matches(scoped.queue_status, scoped.pendencia, p.pendencia_filter)
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
      case when p.sort_key = 'envio_bcc' and p.sort_direction = 'asc' then sort_ready.envio_bcc end asc nulls last,
      case when p.sort_key = 'envio_bcc' and p.sort_direction = 'desc' then sort_ready.envio_bcc end desc nulls last,
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
    numbered.pendencia,
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

revoke all on function public.queue_sla_bucket_matches(public.workflow_stage, text, date, date) from public, anon;
grant execute on function public.queue_sla_bucket_matches(public.workflow_stage, text, date, date) to authenticated;

revoke all on function public.queue_pendencia_filter_matches(public.sentence_status, text, text) from public, anon;
grant execute on function public.queue_pendencia_filter_matches(public.sentence_status, text, text) to authenticated;

revoke all on function public.operational_queue_summary_v2(public.workflow_stage, text, text, text, text) from public, anon;
grant execute on function public.operational_queue_summary_v2(public.workflow_stage, text, text, text, text) to authenticated;

revoke all on function public.operational_queue_sla_counts_v1(public.workflow_stage, text, text, text, text, text) from public, anon;
grant execute on function public.operational_queue_sla_counts_v1(public.workflow_stage, text, text, text, text, text) to authenticated;

revoke all on function public.operational_queue_items_v4(public.workflow_stage, text, text, text, text, integer, text, text, text, text, text) from public, anon;
grant execute on function public.operational_queue_items_v4(public.workflow_stage, text, text, text, text, integer, text, text, text, text, text) to authenticated;

analyze public.sentences;
notify pgrst, 'reload schema';
