-- Aggregate dashboard metrics in Postgres and add keyset pagination for the operational queue.

create index if not exists sentences_envio_bcc_idx
  on public.sentences (envio_bcc)
  where envio_bcc is not null;
create index if not exists sentence_events_event_date_stage_type_responsavel_idx
  on public.sentence_events (data_evento, etapa, tipo_evento, responsavel);
create index if not exists sentences_open_overdue_idx
  on public.sentences (prazo_fatal)
  where cumprimento_status is distinct from 'ENTREGUE'::public.sentence_status;
create or replace function public.dashboard_metrics(from_arg date default null, to_arg date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      coalesce(from_arg, date_trunc('month', current_date)::date) as start_date,
      coalesce(to_arg, current_date) as end_date
  ),
  status_template as (
    select jsonb_build_object('PENDENTE', 0, 'EM ANDAMENTO', 0, 'ESTOQUE', 0) as value
  ),
  cumprimento_status as (
    select coalesce(jsonb_object_agg(status_value, item_count), '{}'::jsonb) as value
    from (
      select cumprimento_status::text as status_value, count(*)::bigint as item_count
      from public.sentences
      where cumprimento_status is not null
        and cumprimento_status <> 'ENTREGUE'::public.sentence_status
      group by cumprimento_status
    ) counts
  ),
  qualidade_status as (
    select coalesce(jsonb_object_agg(status_value, item_count), '{}'::jsonb) as value
    from (
      select qualidade_status::text as status_value, count(*)::bigint as item_count
      from public.sentences
      where qualidade_status is not null
        and qualidade_status <> 'ENTREGUE'::public.sentence_status
      group by qualidade_status
    ) counts
  ),
  days as (
    select generate_series(bounds.start_date, bounds.end_date, interval '1 day')::date as day
    from bounds
  ),
  received_by_day as (
    select s.envio_bcc as day, count(*)::bigint as item_count
    from public.sentences s
    cross join bounds b
    where s.envio_bcc between b.start_date and b.end_date
    group by s.envio_bcc
  ),
  events_by_day as (
    select
      e.data_evento as day,
      count(*) filter (where e.tipo_evento = 'PENDENTE')::bigint as pendente,
      count(*) filter (where e.tipo_evento = 'ENTREGUE' and e.etapa = 'CUMPRIMENTO')::bigint as cumprimento,
      count(*) filter (where e.tipo_evento = 'ENTREGUE' and e.etapa = 'QUALIDADE')::bigint as qualidade
    from public.sentence_events e
    cross join bounds b
    where e.data_evento between b.start_date and b.end_date
    group by e.data_evento
  ),
  points as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(d.day, 'YYYY-MM-DD'),
          'recebido', coalesce(r.item_count, 0),
          'cumprimento', coalesce(e.cumprimento, 0),
          'qualidade', coalesce(e.qualidade, 0),
          'pendente', coalesce(e.pendente, 0)
        )
        order by d.day
      ),
      '[]'::jsonb
    ) as value
    from days d
    left join received_by_day r on r.day = d.day
    left join events_by_day e on e.day = d.day
  ),
  people as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', ranked.responsavel,
          'cumprimento', ranked.cumprimento,
          'qualidade', ranked.qualidade,
          'pendente', ranked.pendente
        )
        order by ranked.cumprimento + ranked.qualidade desc, ranked.responsavel
      ),
      '[]'::jsonb
    ) as value
    from (
      select
        e.responsavel,
        count(*) filter (where e.etapa = 'CUMPRIMENTO')::bigint as cumprimento,
        count(*) filter (where e.etapa = 'QUALIDADE')::bigint as qualidade,
        count(*) filter (where e.tipo_evento = 'PENDENTE')::bigint as pendente
      from public.sentence_events e
      cross join bounds b
      where e.data_evento between b.start_date and b.end_date
        and e.responsavel is not null
      group by e.responsavel
      order by count(*) filter (where e.etapa in ('CUMPRIMENTO', 'QUALIDADE')) desc, e.responsavel
      limit 12
    ) ranked
  ),
  totals as (
    select
      count(*) filter (where qualidade_status is distinct from 'ENTREGUE'::public.sentence_status)::bigint as total,
      count(*) filter (
        where prazo_fatal < current_date
          and cumprimento_status is distinct from 'ENTREGUE'::public.sentence_status
      )::bigint as overdue
    from public.sentences
  )
  select jsonb_build_object(
    'cumprimentoStatus', status_template.value || cumprimento_status.value,
    'qualidadeStatus', status_template.value || qualidade_status.value,
    'points', points.value,
    'people', people.value,
    'total', totals.total,
    'overdue', totals.overdue
  )
  from status_template, cumprimento_status, qualidade_status, points, people, totals;
$$;
grant execute on function public.dashboard_metrics(date, date) to authenticated;
create or replace function public.queue_status_rank(status_arg public.sentence_status)
returns smallint
language sql
immutable
as $$
  select case status_arg
    when 'EM ANDAMENTO'::public.sentence_status then 1::smallint
    when 'PENDENTE'::public.sentence_status then 2::smallint
    when 'ESTOQUE'::public.sentence_status then 3::smallint
    when 'ENTREGUE'::public.sentence_status then 4::smallint
    else 5::smallint
  end
$$;
create index if not exists sentences_queue_keyset_cumprimento_responsavel_idx
  on public.sentences (
    responsavel_cumprimento,
    public.queue_status_rank(cumprimento_status),
    coalesce(data_ultimo_evento, '9999-12-31'::date),
    id
  );
create index if not exists sentences_queue_keyset_cumprimento_idx
  on public.sentences (
    public.queue_status_rank(cumprimento_status),
    coalesce(data_ultimo_evento, '9999-12-31'::date),
    id
  );
create index if not exists sentences_queue_keyset_qualidade_responsavel_idx
  on public.sentences (
    responsavel_qualidade,
    public.queue_status_rank(qualidade_status),
    coalesce(data_ultimo_evento, '9999-12-31'::date),
    id
  )
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;
create index if not exists sentences_queue_keyset_qualidade_idx
  on public.sentences (
    public.queue_status_rank(qualidade_status),
    coalesce(data_ultimo_evento, '9999-12-31'::date),
    id
  )
  where cumprimento_status = 'ENTREGUE'::public.sentence_status;
create or replace function public.operational_queue_items_v2(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'PRIORITY',
  responsible_arg text default null,
  q_arg text default null,
  cursor_arg text default null,
  page_size_arg integer default 50
)
returns table(
  id uuid,
  processo text,
  origem_raw text,
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
  next_cursor text
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
      least(greatest(coalesce(page_size_arg, 50), 1), 100) as page_limit
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
      s.origem_raw,
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
      coalesce(s.data_ultimo_evento, '9999-12-31'::date) as queue_date
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
      not p.is_keyset_cursor
      or (scoped.queue_rank, scoped.queue_date, scoped.id) > (p.cursor_rank, p.cursor_date, p.cursor_id)
    )
  ),
  limited as (
    select filtered.*
    from filtered
    cross join params p
    order by filtered.queue_rank, filtered.queue_date, filtered.id
    offset (select case when is_keyset_cursor then 0 else cursor_offset end from params)
    limit (select page_limit + 1 from params)
  ),
  numbered as (
    select
      limited.*,
      row_number() over (order by limited.queue_rank, limited.queue_date, limited.id) as row_index
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
      when meta.has_next then concat(
        'k|',
        last_visible.queue_rank,
        '|',
        to_char(last_visible.queue_date, 'YYYY-MM-DD'),
        '|',
        last_visible.id,
        '|',
        (select cursor_offset + page_limit from params)
      )
      else null
    end as value
    from meta
    left join last_visible on true
  )
  select
    numbered.id,
    numbered.processo,
    numbered.origem_raw,
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
    cursor_out.value as next_cursor
  from numbered
  cross join params p
  cross join cursor_out
  where numbered.row_index <= p.page_limit
  order by numbered.row_index;
$$;
grant execute on function public.operational_queue_items_v2(public.workflow_stage, text, text, text, text, integer) to authenticated;
analyze public.sentences;
analyze public.sentence_events;
