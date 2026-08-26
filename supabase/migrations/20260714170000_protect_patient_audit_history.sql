create or replace function public.prevent_patient_with_history_deletion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.vendas where cliente_id = old.id)
    or exists (select 1 from public.vendas_documentos where cliente_id = old.id) then
    raise exception 'patient_has_audit_history'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_patient_audit_history_before_delete on public.clientes;

create trigger protect_patient_audit_history_before_delete
before delete on public.clientes
for each row execute function public.prevent_patient_with_history_deletion();
