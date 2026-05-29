alter table public.tutela_import_raw
  drop constraint if exists tutela_import_raw_status_chk;
alter table public.tutela_import_raw
  add constraint tutela_import_raw_status_chk
  check (
    status_importacao is null
    or status_importacao in (
      'novo',
      'duplicado',
      'importado',
      'ignorado',
      'revisar',
      'rejeitado_operacional'
    )
  );
notify pgrst, 'reload schema';
