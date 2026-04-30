create or replace function public.recalculate_sentence_event_state(target_sentence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sentences s
     set data_ultimo_evento = (
           select e.data_evento
             from public.sentence_events e
            where e.sentence_id = target_sentence_id
            order by e.data_evento desc, e.created_at desc, e.id desc
            limit 1
         ),
         cumprimento_status = case
           when exists (
             select 1
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.etapa = 'QUALIDADE'
                and e.tipo_evento = 'ENTREGUE'
           ) then 'ENTREGUE'::public.sentence_status
           else coalesce(
             (
               select e.tipo_evento::text::public.sentence_status
                 from public.sentence_events e
                where e.sentence_id = target_sentence_id
                  and e.etapa = 'CUMPRIMENTO'
                order by e.data_evento desc, e.created_at desc, e.id desc
                limit 1
             ),
             s.cumprimento_status
           )
         end,
         cumprimento_data = coalesce(
           (
             select e.data_evento
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.etapa = 'CUMPRIMENTO'
                and e.tipo_evento = 'ENTREGUE'
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           (
             select e.data_evento
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.etapa = 'QUALIDADE'
                and e.tipo_evento = 'ENTREGUE'
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           s.cumprimento_data
         ),
         qualidade_status = coalesce(
           (
             select e.tipo_evento::text::public.sentence_status
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.etapa = 'QUALIDADE'
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           s.qualidade_status
         ),
         qualidade_data = coalesce(
           (
             select e.data_evento
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.etapa = 'QUALIDADE'
                and e.tipo_evento = 'ENTREGUE'
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           s.qualidade_data
         )
   where s.id = target_sentence_id;
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
    select distinct sentence_id
      from public.sentence_events
     where sentence_id is not null
       and etapa = 'QUALIDADE'
       and tipo_evento = 'ENTREGUE'
  loop
    perform public.recalculate_sentence_event_state(sentence_row.sentence_id);
  end loop;
end;
$$;
