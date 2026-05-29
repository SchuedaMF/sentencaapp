create or replace function public.assign_tutela_responsible_bulk_v3(
  stage_arg public.workflow_stage,
  status_mode_arg text default 'ACTIVE',
  q_arg text default null,
  responsible_arg text default null,
  indicator_arg text default 'ALL',
  date_filters_arg jsonb default '[]'::jsonb,
  status_filters_arg jsonb default '[]'::jsonb,
  target_responsible_arg text default null,
  tutela_ids_arg uuid[] default null
)
returns table(updated_count bigint, skipped_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_total bigint := 0;
  changed_total bigint := 0;
  clean_target_responsible text := nullif(trim(coalesce(target_responsible_arg, '')), '');
  normalized_indicator text := upper(coalesce(nullif(trim(indicator_arg), ''), 'ALL'));
  search_term text := nullif(trim(coalesce(q_arg, '')), '');
  responsible_filter text := nullif(trim(coalesce(responsible_arg, '')), '');
  next_status public.sentence_status := case
    when nullif(trim(coalesce(target_responsible_arg, '')), '') is null then 'ESTOQUE'::public.sentence_status
    else 'EM ANDAMENTO'::public.sentence_status
  end;
begin
  if not public.is_manager() then
    raise exception 'Apenas administradores e gestores ativos podem atribuir responsaveis.';
  end if;

  if stage_arg = 'CUMPRIMENTO'::public.workflow_stage then
    with base_scope as (
      select t.*
      from public.tutelas t
      where not public.tutela_has_pending_operational_rejection(t.id)
        and (tutela_ids_arg is null or t.id = any(tutela_ids_arg))
        and public.tutela_queue_status_matches(status_mode_arg, t.cumprimento_status)
        and public.tutela_queue_status_filters_match(status_filters_arg, t.cumprimento_status, t.qualidade_status)
        and (responsible_filter is null or responsible_filter = 'ALL' or t.responsavel_cumprimento = responsible_filter)
        and public.tutela_queue_date_filters_match(date_filters_arg, t.envio_bcc, t.tratado, t.cumprimento_data, t.qualidade_data)
        and (
          search_term is null
          or upper(coalesce(t.processo, '') || ' ' || coalesce(t.autor, '') || ' ' || coalesce(t.cpf_cnpj, '') || ' ' || coalesce(t.uc, ''))
             like '%' || upper(search_term) || '%'
        )
    ),
    candidate_processes as (
      select distinct processo
      from base_scope
      where processo is not null
    ),
    process_counts as (
      select t.processo, count(*)::bigint as process_group_count
      from public.tutelas t
      join candidate_processes cp on cp.processo = t.processo
      where not public.tutela_has_pending_operational_rejection(t.id)
      group by t.processo
    ),
    process_obf_counts as (
      select
        t.processo,
        public.tutela_normalized_obf(t.obf) as normalized_obf,
        count(*)::bigint as obf_match_count
      from public.tutelas t
      join candidate_processes cp on cp.processo = t.processo
      where not public.tutela_has_pending_operational_rejection(t.id)
        and public.tutela_normalized_obf(t.obf) <> ''
      group by t.processo, public.tutela_normalized_obf(t.obf)
    ),
    filtered_processes as (
      select distinct base_scope.processo
      from base_scope
      left join process_counts on process_counts.processo = base_scope.processo
      left join process_obf_counts
        on process_obf_counts.processo = base_scope.processo
        and process_obf_counts.normalized_obf = public.tutela_normalized_obf(base_scope.obf)
      where public.tutela_indicator_matches_v2(
        normalized_indicator,
        base_scope.obf,
        coalesce(process_counts.process_group_count, 1),
        coalesce(
          process_obf_counts.obf_match_count,
          case when public.tutela_normalized_obf(base_scope.obf) <> '' then 1 else 0 end
        )
      )
    ),
    targets as (
      select t.id
      from public.tutelas t
      join filtered_processes fp on fp.processo = t.processo
      where not public.tutela_has_pending_operational_rejection(t.id)
    ),
    updated as (
      update public.tutelas t
         set responsavel_cumprimento = clean_target_responsible,
             cumprimento_status = case
               when t.cumprimento_status in ('ESTOQUE'::public.sentence_status, 'EM ANDAMENTO'::public.sentence_status) then next_status
               else t.cumprimento_status
             end,
             cumprimento_base_status = case
               when t.cumprimento_status in ('ESTOQUE'::public.sentence_status, 'EM ANDAMENTO'::public.sentence_status) then next_status
               else t.cumprimento_base_status
             end
        from targets c
       where t.id = c.id
       returning t.id
    )
    select (select count(*) from targets), (select count(*) from updated)
      into target_total, changed_total;
  else
    with base_scope as (
      select t.*
      from public.tutelas t
      where not public.tutela_has_pending_operational_rejection(t.id)
        and t.cumprimento_status = 'ENTREGUE'::public.sentence_status
        and (tutela_ids_arg is null or t.id = any(tutela_ids_arg))
        and public.tutela_queue_status_matches(status_mode_arg, t.qualidade_status)
        and public.tutela_queue_status_filters_match(status_filters_arg, t.cumprimento_status, t.qualidade_status)
        and (responsible_filter is null or responsible_filter = 'ALL' or t.responsavel_qualidade = responsible_filter)
        and public.tutela_queue_date_filters_match(date_filters_arg, t.envio_bcc, t.tratado, t.cumprimento_data, t.qualidade_data)
        and (
          search_term is null
          or upper(coalesce(t.processo, '') || ' ' || coalesce(t.autor, '') || ' ' || coalesce(t.cpf_cnpj, '') || ' ' || coalesce(t.uc, ''))
             like '%' || upper(search_term) || '%'
        )
    ),
    candidate_processes as (
      select distinct processo
      from base_scope
      where processo is not null
    ),
    process_counts as (
      select t.processo, count(*)::bigint as process_group_count
      from public.tutelas t
      join candidate_processes cp on cp.processo = t.processo
      where not public.tutela_has_pending_operational_rejection(t.id)
      group by t.processo
    ),
    process_obf_counts as (
      select
        t.processo,
        public.tutela_normalized_obf(t.obf) as normalized_obf,
        count(*)::bigint as obf_match_count
      from public.tutelas t
      join candidate_processes cp on cp.processo = t.processo
      where not public.tutela_has_pending_operational_rejection(t.id)
        and public.tutela_normalized_obf(t.obf) <> ''
      group by t.processo, public.tutela_normalized_obf(t.obf)
    ),
    filtered_processes as (
      select distinct base_scope.processo
      from base_scope
      left join process_counts on process_counts.processo = base_scope.processo
      left join process_obf_counts
        on process_obf_counts.processo = base_scope.processo
        and process_obf_counts.normalized_obf = public.tutela_normalized_obf(base_scope.obf)
      where public.tutela_indicator_matches_v2(
        normalized_indicator,
        base_scope.obf,
        coalesce(process_counts.process_group_count, 1),
        coalesce(
          process_obf_counts.obf_match_count,
          case when public.tutela_normalized_obf(base_scope.obf) <> '' then 1 else 0 end
        )
      )
    ),
    targets as (
      select t.id
      from public.tutelas t
      join filtered_processes fp on fp.processo = t.processo
      where not public.tutela_has_pending_operational_rejection(t.id)
        and t.cumprimento_status = 'ENTREGUE'::public.sentence_status
    ),
    updated as (
      update public.tutelas t
         set responsavel_qualidade = clean_target_responsible,
             qualidade_status = case
               when t.qualidade_status in ('ESTOQUE'::public.sentence_status, 'EM ANDAMENTO'::public.sentence_status) then next_status
               else t.qualidade_status
             end,
             qualidade_base_status = case
               when t.qualidade_status in ('ESTOQUE'::public.sentence_status, 'EM ANDAMENTO'::public.sentence_status) then next_status
               else t.qualidade_base_status
             end
        from targets c
       where t.id = c.id
       returning t.id
    )
    select (select count(*) from targets), (select count(*) from updated)
      into target_total, changed_total;
  end if;

  return query select changed_total, greatest(target_total - changed_total, 0);
end;
$$;
grant execute on function public.assign_tutela_responsible_bulk_v3(public.workflow_stage, text, text, text, text, jsonb, jsonb, text, uuid[]) to authenticated;
notify pgrst, 'reload schema';
