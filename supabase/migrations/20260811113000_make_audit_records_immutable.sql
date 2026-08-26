create or replace function public.prevent_audit_document_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_records_are_immutable'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists prevent_audit_document_update_delete on public.vendas_documentos;
create trigger prevent_audit_document_update_delete
before update or delete on public.vendas_documentos
for each row execute function public.prevent_audit_document_mutation();

create or replace function public.prevent_completed_sale_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.vendas_documentos where venda_id = old.id) then
    raise exception 'audit_records_are_immutable'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_completed_sale_update_delete on public.vendas;
create trigger prevent_completed_sale_update_delete
before update or delete on public.vendas
for each row execute function public.prevent_completed_sale_mutation();

drop policy if exists "Permitir acesso total anonimo storage" on storage.objects;
drop policy if exists "Permitir leitura dos documentos" on storage.objects;
drop policy if exists "Permitir novos documentos" on storage.objects;

create policy "Permitir leitura dos documentos"
on storage.objects
for select
to public
using (bucket_id = 'documentos');

create policy "Permitir novos documentos"
on storage.objects
for insert
to public
with check (bucket_id = 'documentos');
