create index if not exists sentence_events_dashboard_created_date_idx
  on public.sentence_events (data_evento, etapa, tipo_evento, created_by)
  where data_evento is not null;

create or replace function public.dashboard_metrics_v2(
  from_arg date default null,
  to_arg date default null,
  today_arg date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      coalesce(from_arg, date_trunc('month', today_arg::timestamp)::date) as start_date,
      coalesce(to_arg, today_arg) as end_date,
      today_arg as today_date
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
      count(*) filter (where e.etapa = 'CUMPRIMENTO')::bigint as cumprimento,
      count(*) filter (where e.etapa = 'QUALIDADE')::bigint as qualidade
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
        where prazo_fatal < (select today_date from bounds)
          and cumprimento_status is distinct from 'ENTREGUE'::public.sentence_status
      )::bigint as overdue
    from public.sentences
  ),
  production_rows as (
    select coalesce(
      jsonb_agg(to_jsonb(row_value) order by row_value.etapa, row_value.month_count desc, row_value.name),
      '[]'::jsonb
    ) as value
    from bounds b
    cross join lateral public.dashboard_production_metrics(b.today_date) row_value
  )
  select jsonb_build_object(
    'cumprimentoStatus', status_template.value || cumprimento_status.value,
    'qualidadeStatus', status_template.value || qualidade_status.value,
    'points', points.value,
    'people', people.value,
    'total', totals.total,
    'overdue', totals.overdue,
    'productionRows', production_rows.value
  )
  from status_template, cumprimento_status, qualidade_status, points, people, totals, production_rows;
$$;

revoke all on function public.dashboard_metrics_v2(date, date, date) from public, anon;
grant execute on function public.dashboard_metrics_v2(date, date, date) to authenticated;

notify pgrst, 'reload schema';
