drop function if exists public.dashboard_production_metrics(date);

create function public.dashboard_production_metrics(today_arg date default current_date)
returns table(
  person_key text,
  name text,
  is_current_user boolean,
  etapa public.workflow_stage,
  today_count bigint,
  day_count bigint,
  day_delivered_count bigint,
  day_pending_count bigint,
  month_count bigint,
  month_delivered_count bigint,
  month_pending_count bigint,
  month_occurrence_days bigint,
  operation_month_occurrence_days bigint
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
      e.tipo_evento,
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
      count(*) filter (where event_rows.data_evento = today_arg)::bigint as day_count,
      count(*) filter (
        where event_rows.data_evento = today_arg
          and event_rows.tipo_evento = 'ENTREGUE'
      )::bigint as day_delivered_count,
      count(*) filter (
        where event_rows.data_evento = today_arg
          and event_rows.tipo_evento = 'PENDENTE'
      )::bigint as day_pending_count,
      count(*)::bigint as month_count,
      count(*) filter (where event_rows.tipo_evento = 'ENTREGUE')::bigint as month_delivered_count,
      count(*) filter (where event_rows.tipo_evento = 'PENDENTE')::bigint as month_pending_count,
      count(distinct event_rows.data_evento)::bigint as month_occurrence_days
    from event_rows
    where event_rows.responsible_name is not null
    group by event_rows.responsible_name, event_rows.etapa
  ),
  operation_grouped as (
    select
      event_rows.etapa,
      count(distinct event_rows.data_evento)::bigint as operation_month_occurrence_days
    from event_rows
    where event_rows.responsible_name is not null
    group by event_rows.etapa
  )
  select
    md5(upper(grouped.responsible_name)) as person_key,
    case
      when params.can_see_names or upper(grouped.responsible_name) = upper(params.profile_name) then grouped.responsible_name
      else null
    end as name,
    upper(grouped.responsible_name) = upper(params.profile_name) as is_current_user,
    grouped.etapa,
    grouped.day_count as today_count,
    grouped.day_count,
    grouped.day_delivered_count,
    grouped.day_pending_count,
    grouped.month_count,
    grouped.month_delivered_count,
    grouped.month_pending_count,
    grouped.month_occurrence_days,
    coalesce(operation_grouped.operation_month_occurrence_days, 0)::bigint as operation_month_occurrence_days
  from grouped
  cross join params
  left join operation_grouped on operation_grouped.etapa = grouped.etapa;
$$;

revoke all on function public.dashboard_production_metrics(date) from public, anon;
grant execute on function public.dashboard_production_metrics(date) to authenticated;
