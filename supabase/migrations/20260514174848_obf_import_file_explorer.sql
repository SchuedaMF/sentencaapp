create or replace function public.obf_import_files_v1(
  status_arg text default 'all',
  from_arg date default null,
  to_arg date default null,
  query_arg text default null,
  office_arg text default null,
  limit_arg integer default 50,
  offset_arg integer default 0
)
returns table (
  batch_key text,
  import_batch_id text,
  file_name text,
  file_size_bytes text,
  imported_at timestamptz,
  source_kind text,
  total_rows bigint,
  importado_count bigint,
  rejeitado_count bigint,
  pendente_count bigint,
  warning_count bigint,
  inconsistency_count bigint,
  matched_rows bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with normalized_args as (
    select
      lower(coalesce(nullif(status_arg, ''), 'all')) as status_filter,
      nullif(btrim(query_arg), '') as search_filter,
      nullif(btrim(office_arg), '') as office_filter,
      least(greatest(coalesce(limit_arg, 50), 1), 100) as page_limit,
      greatest(coalesce(offset_arg, 0), 0) as page_offset,
      least(from_arg, to_arg) as range_start,
      greatest(from_arg, to_arg) as range_end
  ),
  scoped_rows as (
    select
      coalesce(
        'batch:' || r.import_batch_id::text,
        'file:' || md5(coalesce(r.arquivo_rel, '') || '|' || coalesce(r.arquivo_size_bytes::text, ''))
      ) as batch_key,
      r.*
    from public.obf_escritorio_casos_verificados r
    cross join normalized_args args
    where coalesce(r.tipo_fluxo, '') not ilike '%TUTELA%'
      and (args.office_filter is null or r.escritorio = args.office_filter)
      and (
        args.search_filter is null
        or r.processo ilike '%' || args.search_filter || '%'
        or r.escritorio ilike '%' || args.search_filter || '%'
        or r.tipo_fluxo ilike '%' || args.search_filter || '%'
        or r.arquivo_rel ilike '%' || args.search_filter || '%'
        or r.motivo_status ilike '%' || args.search_filter || '%'
        or r.row_key ilike '%' || args.search_filter || '%'
      )
  ),
  grouped_files as (
    select
      batch_key,
      max(import_batch_id::text) as import_batch_id,
      coalesce(max(nullif(arquivo_rel, '')), 'Arquivo sem nome') as file_name,
      max(nullif(arquivo_size_bytes::text, '')) as file_size_bytes,
      coalesce(max(verificado_em), max(importado_em), max(updated_at), max(created_at)) as imported_at,
      coalesce(string_agg(distinct nullif(tipo_fluxo, ''), ', '), 'OBF') as source_kind,
      count(*)::bigint as total_rows,
      count(*) filter (where status_importacao = 'importado')::bigint as importado_count,
      count(*) filter (where status_importacao = 'rejeitado')::bigint as rejeitado_count,
      count(*) filter (where status_importacao = 'pendente')::bigint as pendente_count,
      count(*) filter (where nullif(btrim(coalesce(motivo_status, '')), '') is not null)::bigint as warning_count,
      count(*) filter (where status_importacao <> 'importado')::bigint as inconsistency_count,
      count(*) filter (
        where (select status_filter from normalized_args) = 'all'
           or status_importacao = (select status_filter from normalized_args)
      )::bigint as matched_rows
    from scoped_rows
    group by batch_key
  ),
  filtered_files as (
    select grouped_files.*
    from grouped_files
    cross join normalized_args args
    where (args.range_start is null or grouped_files.imported_at >= (args.range_start::timestamp at time zone 'America/Sao_Paulo'))
      and (args.range_end is null or grouped_files.imported_at < ((args.range_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
      and (args.status_filter = 'all' or grouped_files.matched_rows > 0)
  )
  select
    filtered_files.batch_key,
    filtered_files.import_batch_id,
    filtered_files.file_name,
    filtered_files.file_size_bytes,
    filtered_files.imported_at,
    filtered_files.source_kind,
    filtered_files.total_rows,
    filtered_files.importado_count,
    filtered_files.rejeitado_count,
    filtered_files.pendente_count,
    filtered_files.warning_count,
    filtered_files.inconsistency_count,
    filtered_files.matched_rows,
    count(*) over ()::bigint as total_count
  from filtered_files
  cross join normalized_args args
  order by filtered_files.imported_at desc nulls last, filtered_files.file_name asc, filtered_files.batch_key asc
  limit (select page_limit from normalized_args)
  offset (select page_offset from normalized_args);
$$;

create or replace function public.obf_import_rows_v1(
  batch_key_arg text default null,
  status_arg text default 'all',
  from_arg date default null,
  to_arg date default null,
  query_arg text default null,
  office_arg text default null,
  limit_arg integer default 50,
  offset_arg integer default 0
)
returns table (
  id uuid,
  row_key text,
  arquivo_rel text,
  arquivo_size_bytes text,
  data_operacional date,
  escritorio text,
  tipo_fluxo text,
  linha_origem integer,
  processo text,
  envio_bcc date,
  status_importacao text,
  motivo_status text,
  destino_tabela text,
  imported_record_id uuid,
  import_batch_id text,
  importado_em timestamptz,
  verificado_em timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  batch_key text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with normalized_args as (
    select
      nullif(btrim(batch_key_arg), '') as selected_batch_key,
      lower(coalesce(nullif(status_arg, ''), 'all')) as status_filter,
      nullif(btrim(query_arg), '') as search_filter,
      nullif(btrim(office_arg), '') as office_filter,
      least(greatest(coalesce(limit_arg, 50), 1), 100) as page_limit,
      greatest(coalesce(offset_arg, 0), 0) as page_offset,
      least(from_arg, to_arg) as range_start,
      greatest(from_arg, to_arg) as range_end
  ),
  scoped_rows as (
    select
      coalesce(
        'batch:' || r.import_batch_id::text,
        'file:' || md5(coalesce(r.arquivo_rel, '') || '|' || coalesce(r.arquivo_size_bytes::text, ''))
      ) as batch_key,
      r.*
    from public.obf_escritorio_casos_verificados r
    cross join normalized_args args
    where coalesce(r.tipo_fluxo, '') not ilike '%TUTELA%'
      and (args.selected_batch_key is null or coalesce(
        'batch:' || r.import_batch_id::text,
        'file:' || md5(coalesce(r.arquivo_rel, '') || '|' || coalesce(r.arquivo_size_bytes::text, ''))
      ) = args.selected_batch_key)
      and (args.office_filter is null or r.escritorio = args.office_filter)
      and (
        args.search_filter is null
        or r.processo ilike '%' || args.search_filter || '%'
        or r.escritorio ilike '%' || args.search_filter || '%'
        or r.tipo_fluxo ilike '%' || args.search_filter || '%'
        or r.arquivo_rel ilike '%' || args.search_filter || '%'
        or r.motivo_status ilike '%' || args.search_filter || '%'
        or r.row_key ilike '%' || args.search_filter || '%'
      )
  ),
  eligible_files as (
    select
      batch_key,
      coalesce(max(verificado_em), max(importado_em), max(updated_at), max(created_at)) as imported_at
    from scoped_rows
    group by batch_key
  ),
  filtered_rows as (
    select scoped_rows.*
    from scoped_rows
    join eligible_files on eligible_files.batch_key = scoped_rows.batch_key
    cross join normalized_args args
    where (args.range_start is null or eligible_files.imported_at >= (args.range_start::timestamp at time zone 'America/Sao_Paulo'))
      and (args.range_end is null or eligible_files.imported_at < ((args.range_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
      and (args.status_filter = 'all' or scoped_rows.status_importacao = args.status_filter)
  )
  select
    filtered_rows.id,
    filtered_rows.row_key,
    filtered_rows.arquivo_rel,
    filtered_rows.arquivo_size_bytes::text,
    filtered_rows.data_operacional,
    filtered_rows.escritorio,
    filtered_rows.tipo_fluxo,
    filtered_rows.linha_origem,
    filtered_rows.processo,
    filtered_rows.envio_bcc,
    filtered_rows.status_importacao,
    filtered_rows.motivo_status,
    filtered_rows.destino_tabela,
    filtered_rows.imported_record_id,
    filtered_rows.import_batch_id::text,
    filtered_rows.importado_em,
    filtered_rows.verificado_em,
    filtered_rows.created_at,
    filtered_rows.updated_at,
    filtered_rows.batch_key,
    count(*) over ()::bigint as total_count
  from filtered_rows
  order by
    filtered_rows.verificado_em desc nulls last,
    filtered_rows.importado_em desc nulls last,
    filtered_rows.updated_at desc nulls last,
    filtered_rows.created_at desc nulls last,
    filtered_rows.id asc
  limit (select page_limit from normalized_args)
  offset (select page_offset from normalized_args);
$$;

create or replace function public.obf_import_summary_v1(
  batch_key_arg text default null,
  status_arg text default 'all',
  from_arg date default null,
  to_arg date default null,
  query_arg text default null,
  office_arg text default null
)
returns table (
  kind text,
  key text,
  value bigint,
  latest_verified_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with normalized_args as (
    select
      nullif(btrim(batch_key_arg), '') as selected_batch_key,
      lower(coalesce(nullif(status_arg, ''), 'all')) as status_filter,
      nullif(btrim(query_arg), '') as search_filter,
      nullif(btrim(office_arg), '') as office_filter,
      least(from_arg, to_arg) as range_start,
      greatest(from_arg, to_arg) as range_end
  ),
  base_rows as (
    select
      coalesce(
        'batch:' || r.import_batch_id::text,
        'file:' || md5(coalesce(r.arquivo_rel, '') || '|' || coalesce(r.arquivo_size_bytes::text, ''))
      ) as batch_key,
      r.*
    from public.obf_escritorio_casos_verificados r
    where coalesce(r.tipo_fluxo, '') not ilike '%TUTELA%'
  ),
  query_scoped_rows as (
    select base_rows.*
    from base_rows
    cross join normalized_args args
    where (args.selected_batch_key is null or base_rows.batch_key = args.selected_batch_key)
      and (
        args.search_filter is null
        or base_rows.processo ilike '%' || args.search_filter || '%'
        or base_rows.escritorio ilike '%' || args.search_filter || '%'
        or base_rows.tipo_fluxo ilike '%' || args.search_filter || '%'
        or base_rows.arquivo_rel ilike '%' || args.search_filter || '%'
        or base_rows.motivo_status ilike '%' || args.search_filter || '%'
        or base_rows.row_key ilike '%' || args.search_filter || '%'
      )
  ),
  eligible_files as (
    select
      batch_key,
      coalesce(max(verificado_em), max(importado_em), max(updated_at), max(created_at)) as imported_at
    from query_scoped_rows
    group by batch_key
  ),
  rows_in_period as (
    select query_scoped_rows.*, eligible_files.imported_at
    from query_scoped_rows
    join eligible_files on eligible_files.batch_key = query_scoped_rows.batch_key
    cross join normalized_args args
    where (args.range_start is null or eligible_files.imported_at >= (args.range_start::timestamp at time zone 'America/Sao_Paulo'))
      and (args.range_end is null or eligible_files.imported_at < ((args.range_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
  ),
  filtered_rows as (
    select rows_in_period.*
    from rows_in_period
    cross join normalized_args args
    where (args.office_filter is null or rows_in_period.escritorio = args.office_filter)
      and (args.status_filter = 'all' or rows_in_period.status_importacao = args.status_filter)
  ),
  office_rows as (
    select rows_in_period.*
    from rows_in_period
    cross join normalized_args args
    where (args.status_filter = 'all' or rows_in_period.status_importacao = args.status_filter)
  )
  select 'status', 'importado', count(*) filter (where status_importacao = 'importado')::bigint, null::timestamptz
  from filtered_rows
  union all
  select 'status', 'rejeitado', count(*) filter (where status_importacao = 'rejeitado')::bigint, null::timestamptz
  from filtered_rows
  union all
  select 'status', 'pendente', count(*) filter (where status_importacao = 'pendente')::bigint, null::timestamptz
  from filtered_rows
  union all
  select 'office', escritorio, count(*)::bigint, null::timestamptz
  from office_rows
  where nullif(btrim(coalesce(escritorio, '')), '') is not null
  group by escritorio
  union all
  select 'rejected_reason', motivo_status, count(*)::bigint, null::timestamptz
  from rows_in_period
  cross join normalized_args args
  where (args.office_filter is null or rows_in_period.escritorio = args.office_filter)
    and rows_in_period.status_importacao = 'rejeitado'
    and nullif(btrim(coalesce(rows_in_period.motivo_status, '')), '') is not null
  group by motivo_status
  union all
  select 'latest', 'latest_verified_at', count(*)::bigint, max(imported_at)
  from filtered_rows;
$$;

revoke all on function public.obf_import_files_v1(text, date, date, text, text, integer, integer) from public;
revoke all on function public.obf_import_rows_v1(text, text, date, date, text, text, integer, integer) from public;
revoke all on function public.obf_import_summary_v1(text, text, date, date, text, text) from public;

grant execute on function public.obf_import_files_v1(text, date, date, text, text, integer, integer) to authenticated;
grant execute on function public.obf_import_rows_v1(text, text, date, date, text, text, integer, integer) to authenticated;
grant execute on function public.obf_import_summary_v1(text, text, date, date, text, text) to authenticated;

notify pgrst, 'reload schema';
