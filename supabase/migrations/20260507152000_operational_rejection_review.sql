alter table public.tutela_import_raw add column if not exists operational_review_status text;
alter table public.tutela_import_raw add column if not exists operational_review_tutela_id uuid;
alter table public.tutela_import_raw add column if not exists operational_review_reason text;
alter table public.tutela_import_raw add column if not exists operational_review_requested_by uuid references public.profiles(id) on delete set null;
alter table public.tutela_import_raw add column if not exists operational_review_requested_at timestamptz;
alter table public.tutela_import_raw add column if not exists operational_review_decided_by uuid references public.profiles(id) on delete set null;
alter table public.tutela_import_raw add column if not exists operational_review_decided_at timestamptz;
alter table public.tutela_import_raw add column if not exists operational_review_decision_note text;
alter table public.tutela_import_raw
  drop constraint if exists tutela_import_raw_operational_review_status_check;
alter table public.tutela_import_raw
  add constraint tutela_import_raw_operational_review_status_check
  check (
    operational_review_status is null
    or operational_review_status in ('PENDING', 'APPROVED', 'DISMISSED')
  );
create index if not exists tutela_import_raw_operational_review_status_idx
  on public.tutela_import_raw (operational_review_status, operational_review_requested_at desc);
create index if not exists tutela_import_raw_operational_review_tutela_idx
  on public.tutela_import_raw (operational_review_tutela_id);
create or replace function public.tutela_has_pending_operational_rejection(tutela_id_arg uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tutela_import_raw r
    where r.operational_review_status = 'PENDING'
      and (
        r.operational_review_tutela_id = tutela_id_arg
        or r.imported_tutela_id = tutela_id_arg
      )
  )
$$;
create or replace function public.request_tutela_operational_rejection(
  tutela_id_arg uuid,
  reason_arg text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tutelas;
  reason_text text := nullif(btrim(coalesce(reason_arg, '')), '');
  target_raw_id uuid;
  now_value timestamptz := now();
begin
  if reason_text is null then
    raise exception 'Informe o motivo da rejeicao operacional.' using errcode = '22023';
  end if;

  select *
    into current_row
    from public.tutelas
   where id = tutela_id_arg;

  if not found then
    raise exception 'Tutela nao encontrada.' using errcode = 'P0002';
  end if;

  if not public.can_access_tutela(current_row) then
    raise exception 'Sem permissao para rejeitar este caso.' using errcode = '42501';
  end if;

  select r.id
    into target_raw_id
    from public.tutela_import_raw r
   where r.operational_review_status = 'PENDING'
     and (
       r.operational_review_tutela_id = current_row.id
       or r.imported_tutela_id = current_row.id
     )
   order by coalesce(r.operational_review_requested_at, r.updated_at, r.created_at) desc, r.id
   limit 1;

  if target_raw_id is null then
    select r.id
      into target_raw_id
      from public.tutela_import_raw r
     where r.imported_tutela_id = current_row.id
     order by r.created_at desc, r.id
     limit 1;
  end if;

  if target_raw_id is null and current_row.import_batch_id is not null and current_row.import_row_number is not null then
    select r.id
      into target_raw_id
      from public.tutela_import_raw r
     where r.import_batch_id = current_row.import_batch_id
       and r.linha_origem = current_row.import_row_number
     order by r.created_at desc, r.id
     limit 1;
  end if;

  if target_raw_id is null then
    insert into public.tutela_import_raw (
      import_batch_id,
      fonte,
      arquivo_origem,
      linha_origem,
      data_chegada,
      processo,
      cpf_cnpj,
      autor,
      municipio_raw,
      tipo_justica,
      situacao_liminar,
      envio_bcc,
      tratado,
      obf,
      valor_multa,
      prazo_fatal,
      status_importacao,
      classificacao_original,
      raw_payload,
      imported_tutela_id,
      created_at,
      updated_at,
      source_key,
      uc,
      endereco_obf,
      tipo_cliente,
      advogado_responsavel
    )
    values (
      current_row.import_batch_id,
      coalesce(current_row.origem_raw, 'operacional'),
      'revisao_operacional',
      current_row.import_row_number,
      current_row.data_chegada,
      current_row.processo,
      current_row.cpf_cnpj,
      current_row.autor,
      current_row.municipio_raw,
      current_row.tipo_justica_raw,
      current_row.situacao_liminar_raw,
      current_row.envio_bcc,
      current_row.tratado,
      current_row.obf,
      current_row.valor_multa,
      current_row.prazo_fatal,
      'importado',
      'revisao_operacional_sintetica',
      jsonb_build_object(
        'synthetic_operational_review', true,
        'tutela_snapshot', to_jsonb(current_row)
      ),
      current_row.id,
      now_value,
      now_value,
      'operational:' || current_row.id::text,
      current_row.uc,
      current_row.endereco_obf,
      current_row.tipo_cliente,
      current_row.advogado_responsavel
    )
    returning id into target_raw_id;
  end if;

  update public.tutela_import_raw r
     set imported_tutela_id = current_row.id,
         operational_review_status = 'PENDING',
         operational_review_tutela_id = current_row.id,
         operational_review_reason = reason_text,
         operational_review_requested_by = auth.uid(),
         operational_review_requested_at = now_value,
         operational_review_decided_by = null,
         operational_review_decided_at = null,
         operational_review_decision_note = null,
         updated_at = now_value,
         raw_payload = coalesce(r.raw_payload, '{}'::jsonb) || jsonb_build_object(
           'operational_review', jsonb_build_object(
             'status', 'PENDING',
             'reason', reason_text,
             'requested_by', auth.uid(),
             'requested_at', now_value
           ),
           'tutela_snapshot', to_jsonb(current_row)
         )
   where r.id = target_raw_id;

  return target_raw_id;
end;
$$;
create or replace function public.review_tutela_operational_rejection(
  raw_id_arg uuid,
  decision_arg text,
  note_arg text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_row public.tutela_import_raw;
  target_tutela_id uuid;
  normalized_decision text := upper(nullif(btrim(coalesce(decision_arg, '')), ''));
  note_text text := nullif(btrim(coalesce(note_arg, '')), '');
  reason_text text;
  now_value timestamptz := now();
  tutela_snapshot jsonb := null;
begin
  if not public.is_manager() then
    raise exception 'Apenas gestores podem revisar rejeicoes operacionais.' using errcode = '42501';
  end if;

  if normalized_decision is null or normalized_decision not in ('APPROVE_REJECTION', 'KEEP_CASE') then
    raise exception 'Decisao de revisao operacional invalida.' using errcode = '22023';
  end if;

  select *
    into raw_row
    from public.tutela_import_raw
   where id = raw_id_arg
   for update;

  if not found then
    raise exception 'Registro de importacao nao encontrado.' using errcode = 'P0002';
  end if;

  if raw_row.operational_review_status is distinct from 'PENDING' then
    raise exception 'Esta rejeicao operacional nao esta pendente.' using errcode = '22023';
  end if;

  target_tutela_id := coalesce(raw_row.operational_review_tutela_id, raw_row.imported_tutela_id);

  if target_tutela_id is null then
    raise exception 'Registro sem tutela vinculada para revisao.' using errcode = '22023';
  end if;

  if normalized_decision = 'KEEP_CASE' then
    update public.tutela_import_raw r
       set operational_review_status = 'DISMISSED',
           operational_review_decided_by = auth.uid(),
           operational_review_decided_at = now_value,
           operational_review_decision_note = note_text,
           updated_at = now_value,
           raw_payload = coalesce(r.raw_payload, '{}'::jsonb) || jsonb_build_object(
             'operational_review', jsonb_build_object(
               'status', 'DISMISSED',
               'reason', raw_row.operational_review_reason,
               'requested_by', raw_row.operational_review_requested_by,
               'requested_at', raw_row.operational_review_requested_at,
               'decided_by', auth.uid(),
               'decided_at', now_value,
               'decision_note', note_text
             )
           )
     where r.id = raw_id_arg;

    return target_tutela_id;
  end if;

  select to_jsonb(t)
    into tutela_snapshot
    from public.tutelas t
   where t.id = target_tutela_id;

  reason_text := coalesce(raw_row.operational_review_reason, raw_row.motivo_ignorado, 'Rejeicao operacional aprovada.');

  update public.tutela_import_raw r
     set status_importacao = 'rejeitado_operacional',
         motivo_ignorado = reason_text,
         imported_tutela_id = null,
         operational_review_status = 'APPROVED',
         operational_review_tutela_id = target_tutela_id,
         operational_review_decided_by = auth.uid(),
         operational_review_decided_at = now_value,
         operational_review_decision_note = note_text,
         updated_at = now_value,
         raw_payload = coalesce(r.raw_payload, '{}'::jsonb) || jsonb_build_object(
           'operational_review', jsonb_build_object(
             'status', 'APPROVED',
             'reason', reason_text,
             'requested_by', raw_row.operational_review_requested_by,
             'requested_at', raw_row.operational_review_requested_at,
             'decided_by', auth.uid(),
             'decided_at', now_value,
             'decision_note', note_text
           ),
           'deleted_tutela_snapshot', coalesce(tutela_snapshot, raw_row.raw_payload->'tutela_snapshot')
         )
   where r.id = raw_id_arg;

  delete from public.tutelas t
   where t.id = target_tutela_id;

  return target_tutela_id;
end;
$$;
create or replace function public.tutela_import_raw_items_v2(
  batch_arg uuid default null,
  status_arg text default 'ALL',
  date_from_arg timestamptz default null,
  date_to_arg timestamptz default null,
  origin_kind_arg text default 'ALL',
  office_arg text default null,
  cursor_arg integer default 0,
  page_size_arg integer default 50
)
returns table(
  id uuid,
  import_batch_id uuid,
  fonte text,
  arquivo_origem text,
  escritorio text,
  linha_origem integer,
  data_arquivo date,
  data_chegada date,
  processo text,
  cpf_cnpj text,
  autor text,
  municipio_raw text,
  tipo_justica text,
  situacao_liminar text,
  envio_bcc date,
  tratado date,
  obf text,
  valor_multa numeric,
  prazo_fatal date,
  status_importacao text,
  classificacao_original text,
  motivo_ignorado text,
  duplicado_de_id text,
  raw_payload jsonb,
  imported_tutela_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  source_key text,
  uc text,
  endereco_obf text,
  tipo_cliente text,
  advogado_responsavel text,
  data_chegada_fonte text,
  has_warning boolean,
  warning_count bigint,
  warning_messages text[],
  origin_kind text,
  batch_file_name text,
  batch_source_kind text,
  batch_created_at timestamptz,
  operational_review_status text,
  operational_review_tutela_id uuid,
  operational_review_reason text,
  operational_review_requested_by uuid,
  operational_review_requested_at timestamptz,
  operational_review_decided_by uuid,
  operational_review_decided_at timestamptz,
  operational_review_decision_note text,
  operational_review_requested_by_name text,
  operational_review_decided_by_name text,
  total_count bigint,
  next_cursor text
)
language sql
stable
security definer
set search_path = public
as $$
  with base_filtered as (
    select
      r.*,
      public.tutela_import_origin_kind(r.fonte, r.escritorio) as origin_kind,
      b.file_name as batch_file_name,
      b.source_kind as batch_source_kind,
      b.created_at as batch_created_at,
      coalesce(req.full_name, req.email) as requested_by_name,
      coalesce(dec.full_name, dec.email) as decided_by_name,
      coalesce(
        case when r.operational_review_status = 'PENDING' then r.operational_review_requested_at end,
        r.created_at
      ) as filter_created_at
    from public.tutela_import_raw r
    left join public.tutela_import_batches b on b.id = r.import_batch_id
    left join public.profiles req on req.id = r.operational_review_requested_by
    left join public.profiles dec on dec.id = r.operational_review_decided_by
    where public.is_manager()
      and (batch_arg is null or r.import_batch_id = batch_arg)
      and (date_from_arg is null or coalesce(
        case when r.operational_review_status = 'PENDING' then r.operational_review_requested_at end,
        r.created_at
      ) >= date_from_arg)
      and (date_to_arg is null or coalesce(
        case when r.operational_review_status = 'PENDING' then r.operational_review_requested_at end,
        r.created_at
      ) < date_to_arg)
      and (
        upper(coalesce(origin_kind_arg, 'ALL')) = 'ALL'
        or public.tutela_import_origin_kind(r.fonte, r.escritorio) = upper(origin_kind_arg)
      )
      and (
        nullif(btrim(coalesce(office_arg, '')), '') is null
        or lower(btrim(coalesce(r.escritorio, ''))) = lower(btrim(office_arg))
      )
  ),
  warning_keys as (
    select distinct import_batch_id, linha_origem
    from base_filtered
    where import_batch_id is not null
      and linha_origem is not null
  ),
  warning_rows as (
    select
      e.import_batch_id,
      e.row_number,
      count(*)::bigint as warning_count,
      array_agg(e.message order by e.created_at, e.id) as warning_messages
    from public.tutela_import_errors e
    join warning_keys k
      on k.import_batch_id = e.import_batch_id
     and k.linha_origem = e.row_number
    where e.severity = 'warning'
    group by e.import_batch_id, e.row_number
  ),
  filtered as (
    select
      base_filtered.*,
      coalesce(w.warning_count, 0)::bigint as warning_count,
      coalesce(w.warning_messages, array[]::text[]) as warning_messages
    from base_filtered
    left join warning_rows w
      on w.import_batch_id = base_filtered.import_batch_id
     and w.row_number = base_filtered.linha_origem
    where (
        upper(coalesce(status_arg, 'ALL')) = 'ALL'
        or (upper(coalesce(status_arg, 'ALL')) = 'OPERATIONAL_REVIEW' and base_filtered.operational_review_status = 'PENDING')
        or (upper(coalesce(status_arg, 'ALL')) = 'IMPORTED' and base_filtered.status_importacao = 'importado' and base_filtered.operational_review_status is distinct from 'PENDING')
        or (upper(coalesce(status_arg, 'ALL')) = 'REJECTED' and base_filtered.status_importacao is distinct from 'importado' and base_filtered.operational_review_status is distinct from 'PENDING')
        or (upper(coalesce(status_arg, 'ALL')) = 'REVIEW' and base_filtered.status_importacao = 'importado' and base_filtered.operational_review_status is distinct from 'PENDING' and coalesce(w.warning_count, 0) > 0)
      )
  ),
  counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
    order by filtered.filter_created_at desc, filtered.linha_origem asc nulls last, filtered.id asc
    offset greatest(coalesce(cursor_arg, 0), 0)
    limit greatest(coalesce(page_size_arg, 50), 1)
  )
  select
    c.id,
    c.import_batch_id,
    c.fonte,
    c.arquivo_origem,
    c.escritorio,
    c.linha_origem,
    c.data_arquivo,
    c.data_chegada,
    c.processo,
    c.cpf_cnpj,
    c.autor,
    c.municipio_raw,
    c.tipo_justica,
    c.situacao_liminar,
    c.envio_bcc,
    c.tratado,
    c.obf,
    c.valor_multa,
    c.prazo_fatal,
    c.status_importacao,
    c.classificacao_original,
    c.motivo_ignorado,
    c.duplicado_de_id::text,
    c.raw_payload,
    c.imported_tutela_id,
    c.created_at,
    c.updated_at,
    c.source_key,
    c.uc,
    c.endereco_obf,
    c.tipo_cliente,
    c.advogado_responsavel,
    c.data_chegada_fonte::text,
    c.warning_count > 0,
    c.warning_count,
    c.warning_messages,
    c.origin_kind,
    c.batch_file_name,
    c.batch_source_kind,
    c.batch_created_at,
    c.operational_review_status,
    c.operational_review_tutela_id,
    c.operational_review_reason,
    c.operational_review_requested_by,
    c.operational_review_requested_at,
    c.operational_review_decided_by,
    c.operational_review_decided_at,
    c.operational_review_decision_note,
    c.requested_by_name,
    c.decided_by_name,
    c.total_count,
    case when greatest(coalesce(cursor_arg, 0), 0) + greatest(coalesce(page_size_arg, 50), 1) < c.total_count
      then (greatest(coalesce(cursor_arg, 0), 0) + greatest(coalesce(page_size_arg, 50), 1))::text
      else null
    end as next_cursor
  from counted c
$$;
create or replace function public.tutela_import_raw_summary_v2(
  batch_arg uuid default null,
  status_arg text default 'ALL',
  date_from_arg timestamptz default null,
  date_to_arg timestamptz default null,
  origin_kind_arg text default 'ALL',
  office_arg text default null
)
returns table(kind text, value text, item_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with base_filtered as (
    select
      r.*,
      public.tutela_import_origin_kind(r.fonte, r.escritorio) as origin_kind
    from public.tutela_import_raw r
    where public.is_manager()
      and (batch_arg is null or r.import_batch_id = batch_arg)
      and (date_from_arg is null or coalesce(
        case when r.operational_review_status = 'PENDING' then r.operational_review_requested_at end,
        r.created_at
      ) >= date_from_arg)
      and (date_to_arg is null or coalesce(
        case when r.operational_review_status = 'PENDING' then r.operational_review_requested_at end,
        r.created_at
      ) < date_to_arg)
      and (
        upper(coalesce(origin_kind_arg, 'ALL')) = 'ALL'
        or public.tutela_import_origin_kind(r.fonte, r.escritorio) = upper(origin_kind_arg)
      )
      and (
        nullif(btrim(coalesce(office_arg, '')), '') is null
        or lower(btrim(coalesce(r.escritorio, ''))) = lower(btrim(office_arg))
      )
  ),
  warning_keys as (
    select distinct import_batch_id, linha_origem
    from base_filtered
    where import_batch_id is not null
      and linha_origem is not null
  ),
  warning_rows as (
    select
      e.import_batch_id,
      e.row_number,
      count(*)::bigint as warning_count
    from public.tutela_import_errors e
    join warning_keys k
      on k.import_batch_id = e.import_batch_id
     and k.linha_origem = e.row_number
    where e.severity = 'warning'
    group by e.import_batch_id, e.row_number
  ),
  filtered as (
    select
      base_filtered.*,
      coalesce(w.warning_count, 0)::bigint as warning_count
    from base_filtered
    left join warning_rows w
      on w.import_batch_id = base_filtered.import_batch_id
     and w.row_number = base_filtered.linha_origem
    where (
        upper(coalesce(status_arg, 'ALL')) = 'ALL'
        or (upper(coalesce(status_arg, 'ALL')) = 'OPERATIONAL_REVIEW' and base_filtered.operational_review_status = 'PENDING')
        or (upper(coalesce(status_arg, 'ALL')) = 'IMPORTED' and base_filtered.status_importacao = 'importado' and base_filtered.operational_review_status is distinct from 'PENDING')
        or (upper(coalesce(status_arg, 'ALL')) = 'REJECTED' and base_filtered.status_importacao is distinct from 'importado' and base_filtered.operational_review_status is distinct from 'PENDING')
        or (upper(coalesce(status_arg, 'ALL')) = 'REVIEW' and base_filtered.status_importacao = 'importado' and base_filtered.operational_review_status is distinct from 'PENDING' and coalesce(w.warning_count, 0) > 0)
      )
  )
  select 'total', 'ALL', count(*)::bigint from filtered
  union all
  select 'status', 'IMPORTED', count(*) filter (where status_importacao = 'importado' and operational_review_status is distinct from 'PENDING')::bigint from filtered
  union all
  select 'status', 'REJECTED', count(*) filter (where status_importacao is distinct from 'importado' and operational_review_status is distinct from 'PENDING')::bigint from filtered
  union all
  select 'status', 'REVIEW', count(*) filter (where status_importacao = 'importado' and operational_review_status is distinct from 'PENDING' and warning_count > 0)::bigint from filtered
  union all
  select 'status', 'OPERATIONAL_REVIEW', count(*) filter (where operational_review_status = 'PENDING')::bigint from filtered
  union all
  select 'origin', 'TRIAGE', count(*) filter (where origin_kind = 'TRIAGE')::bigint from filtered
  union all
  select 'origin', 'OFFICE', count(*) filter (where origin_kind = 'OFFICE')::bigint from filtered
  union all
  select 'office', nullif(btrim(escritorio), ''), count(*)::bigint
  from filtered
  where origin_kind = 'OFFICE'
    and nullif(btrim(escritorio), '') is not null
  group by nullif(btrim(escritorio), '')
  union all
  select 'latestUpdatedAt', max(coalesce(operational_review_decided_at, operational_review_requested_at, updated_at, created_at))::text, 0::bigint from filtered
$$;
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.tutela_operational_queue_summary_v5(public.workflow_stage,text,text,jsonb,jsonb,text,text)'::regprocedure);
  if position('tutela_has_pending_operational_rejection(t.id)' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      'where (
      stage_arg = ''CUMPRIMENTO''',
      'where (
      not public.tutela_has_pending_operational_rejection(t.id)
      and stage_arg = ''CUMPRIMENTO'''
    );
    function_definition := replace(
      function_definition,
      'or (
      stage_arg = ''QUALIDADE''',
      'or (
      not public.tutela_has_pending_operational_rejection(t.id)
      and stage_arg = ''QUALIDADE'''
    );
    function_definition := replace(
      function_definition,
      'where public.can_access_tutela(t)',
      'where public.can_access_tutela(t)
      and not public.tutela_has_pending_operational_rejection(t.id)'
    );
    if position('tutela_has_pending_operational_rejection(t.id)' in function_definition) = 0 then
      raise exception 'Nao foi possivel atualizar tutela_operational_queue_summary_v5 para excluir revisoes operacionais pendentes.';
    end if;
    execute function_definition;
  end if;

  function_definition := pg_get_functiondef('public.tutela_operational_queue_items_v6(public.workflow_stage,text,text,jsonb,jsonb,text,text,text,integer,text,text)'::regprocedure);
  if position('tutela_has_pending_operational_rejection(t.id)' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      'where (
      stage_arg = ''CUMPRIMENTO''',
      'where (
      not public.tutela_has_pending_operational_rejection(t.id)
      and stage_arg = ''CUMPRIMENTO'''
    );
    function_definition := replace(
      function_definition,
      'or (
      stage_arg = ''QUALIDADE''',
      'or (
      not public.tutela_has_pending_operational_rejection(t.id)
      and stage_arg = ''QUALIDADE'''
    );
    function_definition := replace(
      function_definition,
      'where public.can_access_tutela(t)',
      'where public.can_access_tutela(t)
      and not public.tutela_has_pending_operational_rejection(t.id)'
    );
    if position('tutela_has_pending_operational_rejection(t.id)' in function_definition) = 0 then
      raise exception 'Nao foi possivel atualizar tutela_operational_queue_items_v6 para excluir revisoes operacionais pendentes.';
    end if;
    execute function_definition;
  end if;

  function_definition := pg_get_functiondef('public.assign_tutela_responsible_bulk_v3(public.workflow_stage,text,text,text,text,jsonb,jsonb,text,uuid[])'::regprocedure);
  if position('tutela_has_pending_operational_rejection(t.id)' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      'from public.tutelas
       group by processo',
      'from public.tutelas
       where not public.tutela_has_pending_operational_rejection(id)
       group by processo'
    );
    function_definition := replace(
      function_definition,
      'where (tutela_ids_arg is null or t.id = any(tutela_ids_arg))',
      'where not public.tutela_has_pending_operational_rejection(t.id)
        and (tutela_ids_arg is null or t.id = any(tutela_ids_arg))'
    );
    function_definition := replace(
      function_definition,
      'where t.cumprimento_status = ''ENTREGUE''::public.sentence_status
        and (tutela_ids_arg is null or t.id = any(tutela_ids_arg))',
      'where not public.tutela_has_pending_operational_rejection(t.id)
        and t.cumprimento_status = ''ENTREGUE''::public.sentence_status
        and (tutela_ids_arg is null or t.id = any(tutela_ids_arg))'
    );
    if position('tutela_has_pending_operational_rejection(t.id)' in function_definition) = 0 then
      raise exception 'Nao foi possivel atualizar assign_tutela_responsible_bulk_v3 para excluir revisoes operacionais pendentes.';
    end if;
    execute function_definition;
  end if;
end
$$;
grant execute on function public.tutela_has_pending_operational_rejection(uuid) to authenticated;
grant execute on function public.request_tutela_operational_rejection(uuid, text) to authenticated;
grant execute on function public.review_tutela_operational_rejection(uuid, text, text) to authenticated;
grant execute on function public.tutela_import_raw_items_v2(uuid, text, timestamptz, timestamptz, text, text, integer, integer) to authenticated;
grant execute on function public.tutela_import_raw_summary_v2(uuid, text, timestamptz, timestamptz, text, text) to authenticated;
notify pgrst, 'reload schema';
