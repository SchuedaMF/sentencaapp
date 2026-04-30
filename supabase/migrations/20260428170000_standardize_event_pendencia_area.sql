alter table public.sentence_events
  drop constraint if exists sentence_events_pendencia_standard_check;

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

create or replace function pg_temp.standard_event_area(value text)
returns text
language sql
immutable
as $$
  select case
    when pg_temp.event_taxonomy_key(value) in ('', 'AREA') then null
    else coalesce(pg_temp.standard_known_event_area(value), pg_temp.clean_event_area_text(value))
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
    pg_temp.standard_event_pendencia(pendencia) as pendencia,
    coalesce(
      pg_temp.standard_event_area(area),
      case
        when pg_temp.standard_event_pendencia(pendencia) = 'ÁREA'
          then pg_temp.standard_known_event_area(pendencia)
        else null
      end
    ) as area
  from public.sentence_events
)
update public.sentence_events target
   set pendencia = normalized.pendencia,
       area = normalized.area
  from normalized
 where target.id = normalized.id
   and (
     target.pendencia is distinct from normalized.pendencia
     or target.area is distinct from normalized.area
   );

alter table public.sentence_events
  add constraint sentence_events_pendencia_standard_check
  check (
    pendencia is null
    or pendencia in (
      'QUESTIONAMENTO AO ESCRITÓRIO',
      'ÁREA',
      'PETICIONADO',
      'CUMPRIMENTO INCORRETO'
    )
  );
