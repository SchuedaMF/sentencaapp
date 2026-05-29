drop policy if exists events_delete_accessible_sentence on public.sentence_events;
create policy events_delete_accessible_sentence on public.sentence_events
for delete
using (
  exists (
    select 1
    from public.sentences s
    where s.id = sentence_events.sentence_id
      and public.can_access_sentence(s)
  )
);
drop trigger if exists sentence_events_apply_to_sentence on public.sentence_events;
create trigger sentence_events_apply_to_sentence
after insert or update or delete on public.sentence_events
for each row execute function public.apply_sentence_event();
