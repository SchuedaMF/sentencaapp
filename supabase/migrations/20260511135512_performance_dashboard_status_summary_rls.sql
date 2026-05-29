create or replace function public.dashboard_status_queue_summary(
  stage_arg public.workflow_stage,
  responsible_arg text default null,
  q_arg text default null
)
returns table(stage public.workflow_stage, kind text, value text, item_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      coalesce((select public.is_manager()), false) as is_manager,
      coalesce((select public.current_profile_name()), '') as profile_name,
      nullif(trim(coalesce(responsible_arg, '')), '') as responsible_filter,
      nullif(trim(coalesce(q_arg, '')), '') as search_term
  ),
  scoped as (
    select
      stage_arg as stage,
      case
        when stage_arg = 'CUMPRIMENTO' then s.cumprimento_status::text
        else s.qualidade_status::text
      end as status_value,
      case
        when stage_arg = 'CUMPRIMENTO' then s.responsavel_cumprimento
        else s.responsavel_qualidade
      end as responsible_value,
      s.processo,
      s.autor,
      s.cpf_cnpj,
      s.uc
    from public.sentences s
    cross join params p
    where (
      stage_arg = 'CUMPRIMENTO'
      and (
        p.is_manager
        or upper(coalesce(s.responsavel_cumprimento, '')) = upper(p.profile_name)
      )
    )
    or (
      stage_arg = 'QUALIDADE'
      and (
        p.is_manager
        or upper(coalesce(s.responsavel_qualidade, '')) = upper(p.profile_name)
      )
    )
  ),
  searched as (
    select scoped.*
    from scoped
    cross join params p
    where p.search_term is null
      or upper(coalesce(scoped.processo, '') || ' ' || coalesce(scoped.autor, '') || ' ' || coalesce(scoped.cpf_cnpj, '') || ' ' || coalesce(scoped.uc, '')) like '%' || upper(p.search_term) || '%'
  )
  select stage, 'status'::text as kind, status_value as value, count(*)::bigint as item_count
    from searched
    cross join params p
   where status_value is not null
     and status_value <> 'ENTREGUE'
     and (
       not p.is_manager
       or p.responsible_filter is null
       or p.responsible_filter = 'ALL'
       or responsible_value = p.responsible_filter
     )
   group by stage, status_value

  union all

  select stage, 'responsible'::text as kind, responsible_value as value, count(*)::bigint as item_count
    from searched
   where status_value is not null
     and status_value <> 'ENTREGUE'
     and responsible_value is not null
   group by stage, responsible_value;
$$;

revoke all on function public.dashboard_status_queue_summary(public.workflow_stage, text, text) from public, anon;
grant execute on function public.dashboard_status_queue_summary(public.workflow_stage, text, text) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.queue_status_rank(status_arg public.sentence_status)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case status_arg
    when 'EM ANDAMENTO'::public.sentence_status then 1::smallint
    when 'PENDENTE'::public.sentence_status then 2::smallint
    when 'ESTOQUE'::public.sentence_status then 3::smallint
    when 'ENTREGUE'::public.sentence_status then 4::smallint
    else 5::smallint
  end
$$;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select using (id = (select auth.uid()) or (select public.is_manager()));

drop policy if exists profiles_admin_write on public.profiles;
drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
for insert with check ((select public.current_profile_role()) = 'admin');

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update using ((select public.current_profile_role()) = 'admin')
with check ((select public.current_profile_role()) = 'admin');

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles
for delete using ((select public.current_profile_role()) = 'admin');

drop policy if exists sentences_manager_write on public.sentences;
drop policy if exists sentences_manager_insert on public.sentences;
create policy sentences_manager_insert on public.sentences
for insert with check ((select public.is_manager()));

drop policy if exists sentences_manager_update on public.sentences;
create policy sentences_manager_update on public.sentences
for update using ((select public.is_manager()))
with check ((select public.is_manager()));

drop policy if exists sentences_manager_delete on public.sentences;
create policy sentences_manager_delete on public.sentences
for delete using ((select public.is_manager()));

drop policy if exists manager_write_imports on public.import_batches;
drop policy if exists manager_insert_imports on public.import_batches;
create policy manager_insert_imports on public.import_batches
for insert with check ((select public.is_manager()));

drop policy if exists manager_update_imports on public.import_batches;
create policy manager_update_imports on public.import_batches
for update using ((select public.is_manager()))
with check ((select public.is_manager()));

drop policy if exists manager_delete_imports on public.import_batches;
create policy manager_delete_imports on public.import_batches
for delete using ((select public.is_manager()));

drop policy if exists manager_write_import_errors on public.import_errors;
drop policy if exists manager_insert_import_errors on public.import_errors;
create policy manager_insert_import_errors on public.import_errors
for insert with check ((select public.is_manager()));

drop policy if exists manager_update_import_errors on public.import_errors;
create policy manager_update_import_errors on public.import_errors
for update using ((select public.is_manager()))
with check ((select public.is_manager()));

drop policy if exists manager_delete_import_errors on public.import_errors;
create policy manager_delete_import_errors on public.import_errors
for delete using ((select public.is_manager()));

drop policy if exists service_types_read on public.service_types;
create policy service_types_read on public.service_types
for select using ((select auth.uid()) is not null);

drop policy if exists service_types_manager_write on public.service_types;
drop policy if exists service_types_manager_insert on public.service_types;
create policy service_types_manager_insert on public.service_types
for insert with check ((select public.is_manager()));

drop policy if exists service_types_manager_update on public.service_types;
create policy service_types_manager_update on public.service_types
for update using ((select public.is_manager()))
with check ((select public.is_manager()));

drop policy if exists service_types_manager_delete on public.service_types;
create policy service_types_manager_delete on public.service_types
for delete using ((select public.is_manager()));

drop policy if exists sentence_services_manager_write on public.sentence_services;
drop policy if exists sentence_services_manager_insert on public.sentence_services;
create policy sentence_services_manager_insert on public.sentence_services
for insert with check ((select public.is_manager()));

drop policy if exists sentence_services_manager_update on public.sentence_services;
create policy sentence_services_manager_update on public.sentence_services
for update using ((select public.is_manager()))
with check ((select public.is_manager()));

drop policy if exists sentence_services_manager_delete on public.sentence_services;
create policy sentence_services_manager_delete on public.sentence_services
for delete using ((select public.is_manager()));

drop policy if exists attachments_write on public.attachments;
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
for insert with check (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
);

drop policy if exists attachments_update on public.attachments;
create policy attachments_update on public.attachments
for update using (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
) with check (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
);

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
for delete using (
  exists (select 1 from public.sentences s where s.id = attachments.sentence_id and public.can_access_sentence(s))
);

drop policy if exists salesforce_orders_manager_write on public.salesforce_orders;
drop policy if exists salesforce_orders_manager_insert on public.salesforce_orders;
create policy salesforce_orders_manager_insert on public.salesforce_orders
for insert with check ((select public.is_manager()));

drop policy if exists salesforce_orders_manager_update on public.salesforce_orders;
create policy salesforce_orders_manager_update on public.salesforce_orders
for update using ((select public.is_manager()))
with check ((select public.is_manager()));

drop policy if exists salesforce_orders_manager_delete on public.salesforce_orders;
create policy salesforce_orders_manager_delete on public.salesforce_orders
for delete using ((select public.is_manager()));

do $$
declare
  stage_table text;
begin
  foreach stage_table in array array[
    'salesforce_orders_import_stage',
    'salesforce_orders_compact_stage',
    'salesforce_orders_compact_stage_map'
  ]
  loop
    if to_regclass(format('public.%I', stage_table)) is not null then
      execute format('alter table public.%I enable row level security', stage_table);
      execute format('revoke all on table public.%I from anon, authenticated', stage_table);
      execute format('grant all on table public.%I to service_role', stage_table);
    end if;
  end loop;
end;
$$;

analyze public.sentences;
analyze public.profiles;
analyze public.salesforce_orders;
