create or replace function public.prevent_completed_sale_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_records_are_immutable'
    using errcode = 'P0001';
end;
$$;

comment on function public.prevent_completed_sale_mutation() is
  'Impede alteracao ou exclusao de qualquer compra para preservar o historico fiscal.';
