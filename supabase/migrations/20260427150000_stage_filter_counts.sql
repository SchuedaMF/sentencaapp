-- Exact filter counts for stage queues without loading thousands of rows in Next.js.

create or replace function public.sentence_stage_filter_counts(stage_arg public.workflow_stage)
returns table(kind text, value text, item_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      cumprimento_status::text as status_value,
      responsavel_cumprimento as responsible_value
    from public.sentences
    where stage_arg = 'CUMPRIMENTO'
      and (
        (select public.is_manager())
        or upper(coalesce(responsavel_cumprimento, '')) = upper(coalesce((select public.current_profile_name()), ''))
      )

    union all

    select
      qualidade_status::text as status_value,
      responsavel_qualidade as responsible_value
    from public.sentences
    where stage_arg = 'QUALIDADE'
      and (
        (select public.is_manager())
        or upper(coalesce(responsavel_qualidade, '')) = upper(coalesce((select public.current_profile_name()), ''))
      )
  )
  select 'status'::text as kind, status_value as value, count(*)::bigint as item_count
    from scoped
   where status_value is not null
   group by status_value

  union all

  select 'responsible'::text as kind, responsible_value as value, count(*)::bigint as item_count
    from scoped
   where responsible_value is not null
   group by responsible_value;
$$;

grant execute on function public.sentence_stage_filter_counts(public.workflow_stage) to authenticated;

create index if not exists sentences_cumprimento_responsavel_status_event_idx
  on public.sentences (responsavel_cumprimento, cumprimento_status, data_ultimo_evento desc);

create index if not exists sentences_qualidade_responsavel_status_event_idx
  on public.sentences (responsavel_qualidade, qualidade_status, data_ultimo_evento desc);

create index if not exists sentences_cumprimento_status_responsavel_event_idx
  on public.sentences (cumprimento_status, responsavel_cumprimento, data_ultimo_evento desc);

create index if not exists sentences_qualidade_status_responsavel_event_idx
  on public.sentences (qualidade_status, responsavel_qualidade, data_ultimo_evento desc);

analyze public.sentences;
