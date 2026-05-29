-- Allow trusted service-role verification while preserving user access checks.

create or replace function public.sentence_process_duplicates(sentence_id_arg uuid)
returns table(
  id uuid,
  is_current boolean,
  legacy_id_sentenca text,
  processo text,
  autor text,
  cpf_cnpj text,
  uc text,
  municipio_raw text,
  tipo_decisao_normalized text,
  observacao text,
  responsavel_cumprimento text,
  responsavel_qualidade text,
  cumprimento_status public.sentence_status,
  qualidade_status public.sentence_status,
  cumprimento_data date,
  qualidade_data date,
  data_ultimo_evento date,
  event_count bigint,
  order_total bigint,
  order_open bigint,
  order_closed bigint,
  order_unknown bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select s.id, s.processo
    from public.sentences s
    where s.id = sentence_id_arg
      and (
        public.can_access_sentence(s)
        or current_setting('request.jwt.claim.role', true) = 'service_role'
      )
    limit 1
  ),
  related as (
    select s.*
    from public.sentences s
    join target t on t.processo = s.processo
  ),
  event_counts as (
    select se.sentence_id, count(*) as event_count
    from public.sentence_events se
    join related r on r.id = se.sentence_id
    group by se.sentence_id
  )
  select
    r.id,
    r.id = t.id as is_current,
    r.legacy_id_sentenca,
    r.processo,
    r.autor,
    r.cpf_cnpj,
    r.uc,
    r.municipio_raw,
    r.tipo_decisao_normalized,
    r.observacao,
    r.responsavel_cumprimento,
    r.responsavel_qualidade,
    r.cumprimento_status,
    r.qualidade_status,
    r.cumprimento_data,
    r.qualidade_data,
    r.data_ultimo_evento,
    coalesce(ec.event_count, 0) as event_count,
    coalesce(sops.total_orders, 0) as order_total,
    coalesce(sops.open_orders, 0) as order_open,
    coalesce(sops.closed_orders, 0) as order_closed,
    coalesce(sops.unknown_orders, 0) as order_unknown
  from related r
  join target t on true
  left join event_counts ec on ec.sentence_id = r.id
  left join public.salesforce_order_process_summaries sops on sops.processo = r.processo
  order by
    (r.id = t.id) desc,
    r.data_ultimo_evento desc nulls last,
    r.id asc;
$$;
grant execute on function public.sentence_process_duplicates(uuid) to authenticated;
grant execute on function public.sentence_process_duplicates(uuid) to service_role;
