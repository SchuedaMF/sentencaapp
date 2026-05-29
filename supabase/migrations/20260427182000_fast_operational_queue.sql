-- Speed up the operational queue by avoiding full filtered counts on every page load.

create extension if not exists pg_trgm;
create index if not exists sentences_queue_search_trgm_idx
  on public.sentences using gin (
    (upper(coalesce(processo, '') || ' ' || coalesce(autor, '') || ' ' || coalesce(cpf_cnpj, '') || ' ' || coalesce(uc, ''))) gin_trgm_ops
  );
create index if not exists sentence_events_sentence_date_idx
  on public.sentence_events (sentence_id, data_evento desc, created_at desc);
create or replace function public.operational_queue_summary(
  stage_arg public.workflow_stage default 'CUMPRIMENTO',
  responsible_arg text default null,
  q_arg text default null
)
returns table(stage public.workflow_stage, kind text, value text, item_count bigint)
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
      nullif(trim(coalesce(q_arg, '')), '') as search_term
  ),
  scoped as (
    select
      stage_arg as stage,
      case
        when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status::text
        else s.qualidade_status::text
      end as status_value,
      case
        when stage_arg = 'CUMPRIMENTO' then s.responsavel_cumprimento
        else s.responsavel_qualidade
      end as responsible_value,
      s.processo,
      s.autor,
      s.cpf_cnpj,
      s.uc
    from public.sentences s
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (
        p.is_manager
        or upper(coalesce(s.responsavel_cumprimento, '')) = upper(p.profile_name)
      )
    )
    or (
      stage_arg = 'QUALIDADE'
      and s.cumprimento_status = 'ENTREGUE'
      and (
        p.is_manager
        or upper(coalesce(s.responsavel_qualidade, '')) = upper(p.profile_name)
      )
    )
  ),
  searched as (
    select scoped.*
    from scoped
    cross join params p
    where p.search_term is null
      or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, '')) like '%' || upper(p.search_term) || '%'
  )
  select stage, 'status'::text as kind, status_value as value, count(*)::bigint as item_count
    from searched
    cross join params p
   where status_value is not null
     and (
       not p.is_manager
       or p.responsible_filter is null
       or p.responsible_filter = 'ALL'
       or responsible_value = p.responsible_filter
     )
   group by stage, status_value

  union all

  select stage, 'responsible'::text as kind, responsible_value as value, count(*)::bigint as item_count
    from searched
   where responsible_value is not null
   group by stage, responsible_value;
$$;
drop function if exists public.operational_queue_items(public.workflow_stage, text, text, text, text, integer);
create function public.operational_queue_items(
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
  total_count bigint
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
      or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, '')) like '%' || upper(p.search_term) || '%'
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
    filtered.data_ultimo_evento,
    null::bigint as total_count
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
grant execute on function public.operational_queue_summary(public.workflow_stage, text, text) to authenticated;
grant execute on function public.operational_queue_items(public.workflow_stage, text, text, text, text, integer) to authenticated;
analyze public.sentences;
analyze public.sentence_events;
