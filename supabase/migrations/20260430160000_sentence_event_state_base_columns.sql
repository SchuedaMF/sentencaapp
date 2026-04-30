alter table public.sentences
  add column if not exists cumprimento_base_status public.sentence_status,
  add column if not exists qualidade_base_status public.sentence_status,
  add column if not exists cumprimento_base_data date,
  add column if not exists qualidade_base_data date,
  add column if not exists data_ultimo_evento_base date;

create or replace function public._migration_sentence_raw_text(raw_payload jsonb, variadic keys text[])
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value = nullif(btrim(raw_payload ->> key), '');
    if value is not null then
      return value;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public._migration_sentence_raw_status(raw_payload jsonb, variadic keys text[])
returns public.sentence_status
language plpgsql
immutable
set search_path = public
as $$
declare
  value text;
  normalized text;
begin
  value = public._migration_sentence_raw_text(raw_payload, variadic keys);
  if value is null then
    return null;
  end if;

  normalized = upper(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g'));
  if normalized in ('ENTREGUE', 'PENDENTE', 'EM ANDAMENTO', 'ESTOQUE') then
    return normalized::public.sentence_status;
  end if;

  return null;
end;
$$;

create or replace function public._migration_sentence_raw_date(raw_payload jsonb, variadic keys text[])
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  value text;
  parsed date;
  excel_serial numeric;
begin
  value = public._migration_sentence_raw_text(raw_payload, variadic keys);
  if value is null or value = '00:00:00' then
    return null;
  end if;

  begin
    if value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
      parsed = substring(value from 1 for 10)::date;
    elsif value ~ '^[0-9]+(\.[0-9]+)?$' then
      excel_serial = value::numeric;
      parsed = date '1899-12-30' + floor(excel_serial)::integer;
    else
      parsed = value::timestamptz::date;
    end if;
  exception when others then
    return null;
  end;

  if parsed < date '2000-01-01' or parsed > date '2035-12-31' then
    return null;
  end if;

  return parsed;
end;
$$;

with operational_event_flags as (
  select
    sentence_id,
    true as has_operational_events
  from public.sentence_events
  where affects_operational_state
  group by sentence_id
),
base_values as (
  select
    s.id,
    coalesce(f.has_operational_events, false) as has_operational_events,
    public._migration_sentence_raw_status(s.raw_import_payload, 'STATUS_CUMPRIMENTO', 'STATUS CUMPRIMENTO') as raw_cumprimento_status,
    public._migration_sentence_raw_status(s.raw_import_payload, 'STATUS_QUALIDADE', 'STATUS QUALIDADE') as raw_qualidade_status,
    public._migration_sentence_raw_date(s.raw_import_payload, 'DATA_CUMPRIMENTO', 'DATA DO INGRESSO CUMPRIMENTO') as raw_cumprimento_data,
    public._migration_sentence_raw_date(s.raw_import_payload, 'DATA_QUALIDADE', 'DATA QUALIDADE') as raw_qualidade_data,
    public._migration_sentence_raw_date(s.raw_import_payload, 'DATA_ULTIMO_EVENTO') as raw_data_ultimo_evento
  from public.sentences s
  left join operational_event_flags f on f.sentence_id = s.id
)
update public.sentences s
   set cumprimento_base_status = coalesce(
         s.cumprimento_base_status,
         case
           when b.has_operational_events then coalesce(
             b.raw_cumprimento_status,
             case
               when nullif(btrim(coalesce(s.responsavel_cumprimento, '')), '') is not null then 'EM ANDAMENTO'::public.sentence_status
               else 'ESTOQUE'::public.sentence_status
             end
           )
           else coalesce(
             s.cumprimento_status,
             b.raw_cumprimento_status,
             case
               when nullif(btrim(coalesce(s.responsavel_cumprimento, '')), '') is not null then 'EM ANDAMENTO'::public.sentence_status
               else 'ESTOQUE'::public.sentence_status
             end
           )
         end
       ),
       qualidade_base_status = coalesce(
         s.qualidade_base_status,
         case
           when b.has_operational_events then coalesce(
             b.raw_qualidade_status,
             case
               when nullif(btrim(coalesce(s.responsavel_qualidade, '')), '') is not null then 'EM ANDAMENTO'::public.sentence_status
               else 'ESTOQUE'::public.sentence_status
             end
           )
           else coalesce(
             s.qualidade_status,
             b.raw_qualidade_status,
             case
               when nullif(btrim(coalesce(s.responsavel_qualidade, '')), '') is not null then 'EM ANDAMENTO'::public.sentence_status
               else 'ESTOQUE'::public.sentence_status
             end
           )
         end
       ),
       cumprimento_base_data = coalesce(
         s.cumprimento_base_data,
         case when b.has_operational_events then b.raw_cumprimento_data else coalesce(s.cumprimento_data, b.raw_cumprimento_data) end
       ),
       qualidade_base_data = coalesce(
         s.qualidade_base_data,
         case when b.has_operational_events then b.raw_qualidade_data else coalesce(s.qualidade_data, b.raw_qualidade_data) end
       ),
       data_ultimo_evento_base = coalesce(
         s.data_ultimo_evento_base,
         case when b.has_operational_events then b.raw_data_ultimo_evento else coalesce(s.data_ultimo_evento, b.raw_data_ultimo_evento) end
       )
  from base_values b
 where b.id = s.id;

update public.sentences
   set cumprimento_base_status = 'EM ANDAMENTO'::public.sentence_status,
       qualidade_base_status = 'ESTOQUE'::public.sentence_status,
       cumprimento_base_data = null,
       qualidade_base_data = null,
       data_ultimo_evento_base = null
 where processo = '0000920-03.2021.8.19.0076';

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
           s.data_ultimo_evento_base
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
             s.cumprimento_base_status
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
           s.cumprimento_base_data
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
           s.qualidade_base_status
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
           s.qualidade_base_data
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

revoke all on function public.recalculate_sentence_event_state(uuid) from public;
revoke all on function public.recalculate_sentence_event_state(uuid) from anon;
revoke all on function public.recalculate_sentence_event_state(uuid) from authenticated;

revoke all on function public.apply_sentence_event() from public;
revoke all on function public.apply_sentence_event() from anon;
revoke all on function public.apply_sentence_event() from authenticated;

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

drop function if exists public._migration_sentence_raw_date(jsonb, text[]);
drop function if exists public._migration_sentence_raw_status(jsonb, text[]);
drop function if exists public._migration_sentence_raw_text(jsonb, text[]);
