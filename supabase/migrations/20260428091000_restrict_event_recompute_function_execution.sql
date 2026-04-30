revoke all on function public.recalculate_sentence_event_state(uuid) from public;
revoke all on function public.recalculate_sentence_event_state(uuid) from anon;
revoke all on function public.recalculate_sentence_event_state(uuid) from authenticated;

revoke all on function public.apply_sentence_event() from public;
revoke all on function public.apply_sentence_event() from anon;
revoke all on function public.apply_sentence_event() from authenticated;
