alter table public.sentence_events
  add column if not exists affects_operational_state boolean not null default true,
  add column if not exists legacy_id_andamento text,
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null,
  add column if not exists import_row_number integer;

create unique index if not exists sentence_events_legacy_id_andamento_uidx
  on public.sentence_events (legacy_id_andamento);

create index if not exists sentence_events_operational_sentence_stage_date_idx
  on public.sentence_events (sentence_id, etapa, data_evento desc, created_at desc, id desc)
  where affects_operational_state;

create or replace function public.recalculate_sentence_event_state(target_sentence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sentences s
     set data_ultimo_evento = coalesce(
           (
             select e.data_evento
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.affects_operational_state
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           s.data_ultimo_evento
         ),
         cumprimento_status = case
           when exists (
             select 1
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.affects_operational_state
                and e.etapa = 'QUALIDADE'
                and e.tipo_evento = 'ENTREGUE'
           ) then 'ENTREGUE'::public.sentence_status
           else coalesce(
             (
               select e.tipo_evento::text::public.sentence_status
                 from public.sentence_events e
                where e.sentence_id = target_sentence_id
                  and e.affects_operational_state
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
                and e.affects_operational_state
                and e.etapa = 'CUMPRIMENTO'
                and e.tipo_evento = 'ENTREGUE'
              order by e.data_evento desc, e.created_at desc, e.id desc
              limit 1
           ),
           (
             select e.data_evento
               from public.sentence_events e
              where e.sentence_id = target_sentence_id
                and e.affects_operational_state
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
                and e.affects_operational_state
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
                and e.affects_operational_state
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
