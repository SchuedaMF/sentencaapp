-- Reduce per-row RLS work and support the sentence list/filter queries.

drop policy if exists sentences_select_by_role on public.sentences;
create policy sentences_select_by_role on public.sentences
for select using (
  (select public.is_manager())
  or upper(coalesce(responsavel_cumprimento, '')) = upper(coalesce((select public.current_profile_name()), ''))
  or upper(coalesce(responsavel_qualidade, '')) = upper(coalesce((select public.current_profile_name()), ''))
);
create index if not exists sentences_cumprimento_status_event_idx
  on public.sentences (cumprimento_status, data_ultimo_evento desc);
create index if not exists sentences_qualidade_status_event_idx
  on public.sentences (qualidade_status, data_ultimo_evento desc);
create index if not exists sentences_cumprimento_responsavel_event_idx
  on public.sentences (responsavel_cumprimento, data_ultimo_evento desc);
create index if not exists sentences_qualidade_responsavel_event_idx
  on public.sentences (responsavel_qualidade, data_ultimo_evento desc);
create index if not exists sentences_cumprimento_assignee_upper_event_idx
  on public.sentences (upper(coalesce(responsavel_cumprimento, '')), data_ultimo_evento desc);
create index if not exists sentences_qualidade_assignee_upper_event_idx
  on public.sentences (upper(coalesce(responsavel_qualidade, '')), data_ultimo_evento desc);
analyze public.sentences;
