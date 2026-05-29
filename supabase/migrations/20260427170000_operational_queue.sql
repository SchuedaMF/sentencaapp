-- Operational queues for cumprimento and qualidade without loading the full sentence table.

create or replace function public.operational_queue_summary()
returns table(stage public.workflow_stage, kind text, value text, item_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      'CUMPRIMENTO'::public.workflow_stage as stage,
      cumprimento_status::text as status_value,
      responsavel_cumprimento as responsible_value
    from public.sentences
    where (
      (select public.is_manager())
      or upper(coalesce(responsavel_cumprimento, '')) = upper(coalesce((select public.current_profile_name()), ''))
    )

    union all

    select
      'QUALIDADE'::public.workflow_stage as stage,
      qualidade_status::text as status_value,
      responsavel_qualidade as responsible_value
    from public.sentences
    where cumprimento_status = 'ENTREGUE'
      and (
        (select public.is_manager())
        or upper(coalesce(responsavel_qualidade, '')) = upper(coalesce((select public.current_profile_name()), ''))
      )
  )
  select stage, 'status'::text as kind, status_value as value, count(*)::bigint as item_count
    from scoped
   where status_value is not null
   group by stage, status_value

  union all

  select stage, 'responsible'::text as kind, responsible_value as value, count(*)::bigint as item_count
    from scoped
   where responsible_value is not null
   group by stage, responsible_value;
$$;
create or replace function public.operational_queue_items(
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
  data_ultimo_evento date
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term,
      case
        when coalesce(cursor_arg, '') ~ '^\d+$' then least(cursor_arg::integer, 100000)
        else 0
      end as page_offset,
      least(greatest(coalesce(page_size_arg, 50), 1), 101) as page_limit
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
      case when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status else s.qualidade_status end as queue_status
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
      and s.cumprimento_status = 'ENTREGUE'
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
      or concat_ws(' ', scoped.processo, scoped.autor, scoped.cpf_cnpj, scoped.uc) ilike '%' || p.search_term || '%'
    )
  )
  select
    filtered.id,
    filtered.processo,
    filtered.origem_raw,
    filtered.tratado,
    filtered.tipo_justica_raw,
    filtered.cpf_cnpj,
    filtered.responsavel_cumprimento,
    filtered.responsavel_qualidade,
    filtered.cumprimento_status,
    filtered.qualidade_status,
    filtered.cumprimento_data,
    filtered.qualidade_data,
    filtered.data_ultimo_evento
  from filtered
  cross join params p
  order by
    case filtered.queue_status
      when 'EM ANDAMENTO' then 1
      when 'PENDENTE' then 2
      when 'ESTOQUE' then 3
      when 'ENTREGUE' then 4
      else 5
    end,
    filtered.data_ultimo_evento asc nulls last,
    filtered.id asc
  offset (select page_offset from params)
  limit (select page_limit from params);
$$;
grant execute on function public.operational_queue_summary() to authenticated;
grant execute on function public.operational_queue_items(public.workflow_stage, text, text, text, text, integer) to authenticated;
create index if not exists sentences_queue_cumprimento_responsavel_status_event_idx
  on public.sentences (responsavel_cumprimento, cumprimento_status, data_ultimo_evento, id);
create index if not exists sentences_queue_cumprimento_status_event_idx
  on public.sentences (cumprimento_status, data_ultimo_evento, id);
create index if not exists sentences_queue_qualidade_responsavel_status_event_ready_idx
  on public.sentences (responsavel_qualidade, qualidade_status, data_ultimo_evento, id)
  where cumprimento_status = 'ENTREGUE';
create index if not exists sentences_queue_qualidade_status_responsavel_event_ready_idx
  on public.sentences (qualidade_status, responsavel_qualidade, data_ultimo_evento, id)
  where cumprimento_status = 'ENTREGUE';
analyze public.sentences;
