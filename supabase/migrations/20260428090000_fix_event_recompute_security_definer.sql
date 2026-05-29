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
         cumprimento_status = coalesce(
           (
             select e.tipo_evento::text::public.sentence_status
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.etapa = 'CUMPRIMENTO'
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           s.cumprimento_status
         ),
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
create or replace function public.apply_sentence_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_sentence_id uuid;
begin
  affected_sentence_id = case
    when tg_op = 'DELETE' then old.sentence_id
    else new.sentence_id
  end;

  perform public.recalculate_sentence_event_state(affected_sentence_id);

  if tg_op = 'UPDATE' and old.sentence_id is distinct from new.sentence_id then
    perform public.recalculate_sentence_event_state(old.sentence_id);
  end if;

  return coalesce(new, old);
end;
$$;
drop trigger if exists sentence_events_apply_to_sentence on public.sentence_events;
create trigger sentence_events_apply_to_sentence
after insert or update or delete on public.sentence_events
for each row execute function public.apply_sentence_event();
do $$
declare
  sentence_row record;
begin
  for sentence_row in
    select distinct sentence_id
      from public.sentence_events
     where sentence_id is not null
  loop
    perform public.recalculate_sentence_event_state(sentence_row.sentence_id);
  end loop;
end;
$$;
