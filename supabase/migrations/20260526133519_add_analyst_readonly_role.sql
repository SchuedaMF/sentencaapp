alter type public.app_role add value if not exists 'analista';

create or replace function public.can_view_all_operational_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role()::text in ('admin', 'gestor', 'analista'), false)
$$;

create or replace function public.can_write_own_events()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role()::text <> 'analista', false)
$$;

create or replace function public.can_access_sentence(sentence_row public.sentences)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_view_all_operational_data()
    or upper(coalesce(sentence_row.responsavel_cumprimento, '')) = upper(coalesce(public.current_profile_name(), ''))
    or upper(coalesce(sentence_row.responsavel_qualidade, '')) = upper(coalesce(public.current_profile_name(), ''))
$$;

drop policy if exists sentences_select_by_role on public.sentences;
create policy sentences_select_by_role on public.sentences
for select using ((select auth.uid()) is not null);

drop policy if exists events_select_by_sentence on public.sentence_events;
create policy events_select_by_sentence on public.sentence_events
for select using ((select auth.uid()) is not null);

drop policy if exists events_insert_accessible_sentence on public.sentence_events;
create policy events_insert_accessible_sentence on public.sentence_events
for insert with check (
  (select public.is_manager())
  or (
    (select public.can_write_own_events())
    and created_by = (select auth.uid())
  )
);

drop policy if exists events_update_accessible_sentence on public.sentence_events;
create policy events_update_accessible_sentence on public.sentence_events
for update
using (
  (select public.is_manager())
  or (
    (select public.can_write_own_events())
    and created_by = (select auth.uid())
  )
)
with check (
  (select public.is_manager())
  or (
    (select public.can_write_own_events())
    and created_by = (select auth.uid())
  )
);

drop policy if exists events_delete_accessible_sentence on public.sentence_events;
create policy events_delete_accessible_sentence on public.sentence_events
for delete using (
  (select public.is_manager())
  or (
    (select public.can_write_own_events())
    and created_by = (select auth.uid())
  )
);

do $$
begin
  if to_regclass('public.salesforce_orders') is not null then
    execute 'drop policy if exists salesforce_orders_select_by_sentence on public.salesforce_orders';
    execute 'create policy salesforce_orders_select_by_sentence on public.salesforce_orders for select using ((select auth.uid()) is not null)';
  end if;

  if to_regclass('public.salesforce_order_process_summaries') is not null then
    execute 'drop policy if exists salesforce_order_process_summaries_select_by_sentence on public.salesforce_order_process_summaries';
    execute 'create policy salesforce_order_process_summaries_select_by_sentence on public.salesforce_order_process_summaries for select using ((select auth.uid()) is not null)';
  end if;
end $$;

revoke all on function public.can_view_all_operational_data() from public, anon;
grant execute on function public.can_view_all_operational_data() to authenticated;

revoke all on function public.can_write_own_events() from public, anon;
grant execute on function public.can_write_own_events() to authenticated;

notify pgrst, 'reload schema';
