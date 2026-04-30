-- Include the exact filtered total with each queue page for precise pagination.

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
      or concat_ws(' ', scoped.processo, scoped.autor, scoped.cpf_cnpj, scoped.uc) ilike '%' || p.search_term || '%'
    )
  ),
  counted as (
    select filtered.*, count(*) over() as total_count
    from filtered
  )
  select
    counted.id,
    counted.processo,
    counted.origem_raw,
    counted.tratado,
    counted.tipo_justica_raw,
    counted.cpf_cnpj,
    counted.responsavel_cumprimento,
    counted.responsavel_qualidade,
    counted.cumprimento_status,
    counted.qualidade_status,
    counted.cumprimento_data,
    counted.qualidade_data,
    counted.data_ultimo_evento,
    counted.total_count
  from counted
  cross join params p
  order by
    case counted.queue_status
      when 'EM ANDAMENTO' then 1
      when 'PENDENTE' then 2
      when 'ESTOQUE' then 3
      when 'ENTREGUE' then 4
      else 5
    end,
    counted.data_ultimo_evento asc nulls last,
    counted.id asc
  offset (select page_offset from params)
  limit (select page_limit from params);
$$;

grant execute on function public.operational_queue_items(public.workflow_stage, text, text, text, text, integer) to authenticated;
