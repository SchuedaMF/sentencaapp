alter table public.obf_escritorio_casos_verificados enable row level security;

revoke all on table public.obf_escritorio_casos_verificados from public;
revoke all on table public.obf_escritorio_casos_verificados from anon;
revoke insert, update, delete, truncate, references, trigger on table public.obf_escritorio_casos_verificados from authenticated;
grant select on table public.obf_escritorio_casos_verificados to authenticated;

drop policy if exists obf_escritorio_casos_verificados_manager_read
  on public.obf_escritorio_casos_verificados;

create policy obf_escritorio_casos_verificados_manager_read
  on public.obf_escritorio_casos_verificados
  for select
  to authenticated
  using (public.is_manager());

notify pgrst, 'reload schema';
