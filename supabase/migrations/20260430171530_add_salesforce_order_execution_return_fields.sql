
alter table public.salesforce_orders
  add column if not exists executor_observations text,
  add column if not exists return_description text;

comment on column public.salesforce_orders.executor_observations is 'Campo Salesforce: Observações do Executante';
comment on column public.salesforce_orders.return_description is 'Campo Salesforce: Descrição retorno';
;
