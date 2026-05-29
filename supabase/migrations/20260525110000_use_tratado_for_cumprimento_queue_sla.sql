do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef(
    'public.operational_queue_items_v3(public.workflow_stage,text,text,text,text,integer,text,text)'::regprocedure
  );

  function_definition := replace(
    function_definition,
    'case when stage_arg = ''CUMPRIMENTO'' then s.envio_bcc else s.data_ultimo_evento end as sla_date',
    'case when stage_arg = ''CUMPRIMENTO'' then s.tratado else s.data_ultimo_evento end as sla_date'
  );

  if function_definition not like '%then s.tratado else s.data_ultimo_evento end as sla_date%' then
    raise exception 'Nao foi possivel atualizar operational_queue_items_v3 para usar tratado no SLA de cumprimento.';
  end if;

  execute function_definition;
end $$;

grant execute on function public.operational_queue_items_v3(public.workflow_stage, text, text, text, text, integer, text, text) to authenticated;
