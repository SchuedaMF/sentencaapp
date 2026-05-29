create or replace function public.recalculate_sentence_event_state(target_sentence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with event_state as (
    select
      (
        select e.data_evento
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as data_ultimo_evento,
      (
        select e.tipo_evento
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as latest_event_type,
      (
        select case
                 when e.pendencia in (
                   'QUESTIONAMENTO AO ESCRITÓRIO',
                   'ÁREA',
                   'PETICIONADO',
                   'CUMPRIMENTO INCORRETO'
                 ) then e.pendencia
                 else null
               end
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as latest_event_pendencia,
      exists (
        select 1
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
           and e.etapa = 'QUALIDADE'
           and e.tipo_evento = 'ENTREGUE'
      ) as has_quality_delivered,
      (
        select e.tipo_evento::text::public.sentence_status
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
           and e.etapa = 'CUMPRIMENTO'
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as cumprimento_event_status,
      (
        select e.data_evento
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
           and e.etapa = 'CUMPRIMENTO'
           and e.tipo_evento = 'ENTREGUE'
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as cumprimento_event_data,
      (
        select e.data_evento
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
           and e.etapa = 'QUALIDADE'
           and e.tipo_evento = 'ENTREGUE'
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as qualidade_delivered_data,
      (
        select e.tipo_evento::text::public.sentence_status
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
           and e.etapa = 'QUALIDADE'
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as qualidade_event_status
  ),
  resolved as (
    select
      s.id,
      coalesce(event_state.data_ultimo_evento, s.data_ultimo_evento_base) as data_ultimo_evento,
      case
        when event_state.has_quality_delivered then 'ENTREGUE'::public.sentence_status
        else coalesce(event_state.cumprimento_event_status, s.cumprimento_base_status)
      end as cumprimento_status,
      coalesce(
        event_state.cumprimento_event_data,
        event_state.qualidade_delivered_data,
        s.cumprimento_base_data
      ) as cumprimento_data,
      coalesce(event_state.qualidade_event_status, s.qualidade_base_status) as qualidade_status,
      coalesce(event_state.qualidade_delivered_data, s.qualidade_base_data) as qualidade_data,
      event_state.latest_event_type,
      event_state.latest_event_pendencia
    from public.sentences s
    cross join event_state
    where s.id = target_sentence_id
  )
  update public.sentences s
     set data_ultimo_evento = resolved.data_ultimo_evento,
         cumprimento_status = resolved.cumprimento_status,
         cumprimento_data = resolved.cumprimento_data,
         qualidade_status = resolved.qualidade_status,
         qualidade_data = resolved.qualidade_data,
         pendencia = case
           when resolved.latest_event_type = 'PENDENTE'::public.event_type
             then resolved.latest_event_pendencia
           else null
         end
    from resolved
   where s.id = resolved.id;
end;
$$;

revoke all on function public.recalculate_sentence_event_state(uuid) from public;
revoke all on function public.recalculate_sentence_event_state(uuid) from anon;
revoke all on function public.recalculate_sentence_event_state(uuid) from authenticated;

do $$
declare
  sentence_row record;
begin
  for sentence_row in
    select id
      from public.sentences
  loop
    perform public.recalculate_sentence_event_state(sentence_row.id);
  end loop;
end;
$$;
