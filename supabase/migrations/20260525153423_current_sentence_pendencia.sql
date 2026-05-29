alter table public.sentences
  add column if not exists pendencia text,
  add column if not exists pendencia_base text;

create or replace function pg_temp.clean_event_area_text(value text)
returns text
language sql
immutable
as $$
  select nullif(upper(trim(regexp_replace(replace(coalesce(value, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g'))), '')
$$;

create or replace function pg_temp.event_taxonomy_key(value text)
returns text
language sql
immutable
as $$
  select upper(trim(regexp_replace(
    translate(
      replace(coalesce(value, ''), chr(160), ' '),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  )))
$$;

create or replace function pg_temp.standard_known_event_area(value text)
returns text
language sql
immutable
as $$
  select case pg_temp.event_taxonomy_key(value)
    when '' then null
    when 'AREA' then null
    when 'ALT CADASTRAIS' then 'ALTERAÇÕES CADASTRAIS'
    when 'ALTERACAO CADASTRAL' then 'ALTERAÇÕES CADASTRAIS'
    when 'ALTERACOES CADASTRAIS' then 'ALTERAÇÕES CADASTRAIS'
    when 'ACRESCIMO DE CARGA' then 'ACRÉSCIMO DE CARGA'
    when 'AR' then 'ENVIO DE AR'
    when 'ENVIO DE A.R' then 'ENVIO DE AR'
    when 'ENVIO DE AR' then 'ENVIO DE AR'
    when 'MANUTENCAO' then 'MANUTENÇÃO'
    when 'COBRANCA PROTESTO/ESPECIAIS' then 'COBRANÇA PROTESTO/ESPECIAIS'
    when 'LIGACAO NOVA' then 'LIGAÇÃO NOVA'
    when 'CANCELAMENTO TOI' then 'CANCELAMENTO DE TOI'
    when 'CANCELAMENTO DE TOI' then 'CANCELAMENTO DE TOI'
    when 'CORTE/RELIGACAO' then 'CORTE/RELIGAÇÃO'
    when 'SUBSTITUICAO DE MEDIDDOR' then 'SUBSTITUIÇÃO DE MEDIDOR'
    when 'SUBSTITUICAO DE MEDIDOR' then 'SUBSTITUIÇÃO DE MEDIDOR'
    when 'CREDITO ACORDO' then 'CRÉDITO ACORDO'
    when 'ESCRITORIO' then 'ESCRITÓRIO'
    when 'ESC' then 'ESCRITÓRIO'
    when 'EVIDENCIAS' then 'EVIDÊNCIAS'
    when 'GD' then 'GD'
    when 'REFAT GD' then 'GD'
    when 'REFORMA DE PADRAO' then 'REFORMA DE PADRÃO'
    when 'RELIGACAO' then 'RELIGAÇÃO'
    when 'TRANSFERENCIA DE DEBITOS' then 'TRANSFERÊNCIA DE DÉBITOS'
    when 'REFATURAMENTO' then 'REFATURAMENTO'
    when 'TOI' then 'TOI'
    when 'FATURAMENTO' then 'FATURAMENTO'
    when 'VISTORIA' then 'VISTORIA'
    when 'RCE' then 'RCE'
    when 'OBRAS' then 'OBRAS'
    when 'PARCELAMENTO' then 'PARCELAMENTO'
    when 'BAIXA RENDA' then 'BAIXA RENDA'
    when 'ENCERRAMENTO CONTRATUAL' then 'ENCERRAMENTO CONTRATUAL'
    when 'GRUPO A' then 'GRUPO A'
    when 'REPARO MEDIDOR' then 'REPARO MEDIDOR'
    when 'RESSARCIMENTO' then 'RESSARCIMENTO'
    when 'TROCA DE TITULARIDADE' then 'TROCA DE TITULARIDADE'
    else null
  end
$$;

create or replace function pg_temp.standard_event_pendencia(value text)
returns text
language sql
immutable
as $$
  select case pg_temp.event_taxonomy_key(value)
    when '' then null
    when 'AREA' then 'ÁREA'
    when 'QUESTIONADO' then 'QUESTIONAMENTO AO ESCRITÓRIO'
    when 'QUESTIONADOAOESCRITORIO' then 'QUESTIONAMENTO AO ESCRITÓRIO'
    when 'QUESTIONADO AO ESCRITORIO' then 'QUESTIONAMENTO AO ESCRITÓRIO'
    when 'QUESTIONAMENTO AO ESCRITORIO' then 'QUESTIONAMENTO AO ESCRITÓRIO'
    when 'ESCRITORIO' then 'QUESTIONAMENTO AO ESCRITÓRIO'
    when 'PETICIONAR' then 'PETICIONADO'
    when 'PETICIONAMENTO ESCRITORIO' then 'PETICIONADO'
    when 'PETICIONADO' then 'PETICIONADO'
    when 'CUMPRIMENTO INCOMPLETO' then 'CUMPRIMENTO INCORRETO'
    when 'CUMPRIMENTO INCORRETO' then 'CUMPRIMENTO INCORRETO'
    when 'ANALISE DE CONS INCLUIDO' then 'ÁREA'
    when 'CANCELAR DEBITO' then 'ÁREA'
    else case when pg_temp.standard_known_event_area(value) is not null then 'ÁREA' else null end
  end
$$;

with normalized as (
  select
    id,
    pg_temp.standard_event_pendencia(pendencia) as pendencia
  from public.sentence_events
  where pendencia is not null
)
update public.sentence_events target
   set pendencia = normalized.pendencia
  from normalized
 where target.id = normalized.id
   and normalized.pendencia is not null
   and target.pendencia is distinct from normalized.pendencia;

with latest_pending_event as (
  select distinct on (e.sentence_id)
    e.sentence_id,
    pg_temp.standard_event_pendencia(e.pendencia) as pendencia
  from public.sentence_events e
  where e.tipo_evento = 'PENDENTE'
    and pg_temp.standard_event_pendencia(e.pendencia) is not null
  order by e.sentence_id, e.data_evento desc, e.created_at desc, e.id desc
),
candidate as (
  select
    s.id,
    case
      when s.cumprimento_status = 'PENDENTE'::public.sentence_status
        or s.qualidade_status = 'PENDENTE'::public.sentence_status
        then coalesce(
          latest_pending_event.pendencia,
          pg_temp.standard_event_pendencia(s.raw_import_payload ->> 'PENDENCIA')
        )
      else null
    end as pendencia
  from public.sentences s
  left join latest_pending_event on latest_pending_event.sentence_id = s.id
)
update public.sentences target
   set pendencia = candidate.pendencia,
       pendencia_base = candidate.pendencia
  from candidate
 where target.id = candidate.id
   and (
     target.pendencia is distinct from candidate.pendencia
     or target.pendencia_base is distinct from candidate.pendencia
   );

alter table public.sentences
  drop constraint if exists sentences_pendencia_standard_check;

alter table public.sentences
  add constraint sentences_pendencia_standard_check
  check (
    (pendencia is null or pendencia in (
      'QUESTIONAMENTO AO ESCRITÓRIO',
      'ÁREA',
      'PETICIONADO',
      'CUMPRIMENTO INCORRETO'
    ))
    and
    (pendencia_base is null or pendencia_base in (
      'QUESTIONAMENTO AO ESCRITÓRIO',
      'ÁREA',
      'PETICIONADO',
      'CUMPRIMENTO INCORRETO'
    ))
  );

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
      ) as qualidade_event_status,
      (
        select e.pendencia
          from public.sentence_events e
         where e.sentence_id = target_sentence_id
           and e.affects_operational_state
           and e.tipo_evento = 'PENDENTE'
           and e.pendencia in (
             'QUESTIONAMENTO AO ESCRITÓRIO',
             'ÁREA',
             'PETICIONADO',
             'CUMPRIMENTO INCORRETO'
           )
         order by e.data_evento desc, e.created_at desc, e.id desc
         limit 1
      ) as operational_pendencia
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
      event_state.operational_pendencia
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
           when resolved.cumprimento_status = 'PENDENTE'::public.sentence_status
             or resolved.qualidade_status = 'PENDENTE'::public.sentence_status
             then coalesce(resolved.operational_pendencia, s.pendencia_base)
           else null
         end
    from resolved
   where s.id = resolved.id;
end;
$$;

revoke all on function public.recalculate_sentence_event_state(uuid) from public;
revoke all on function public.recalculate_sentence_event_state(uuid) from anon;
revoke all on function public.recalculate_sentence_event_state(uuid) from authenticated;
