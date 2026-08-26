begin;

do $$
begin
  if not exists (
    select 1 from public.user_profiles
    where role = 'admin' and active = true
  ) then
    raise exception 'security_activation_requires_active_admin';
  end if;

  if not exists (select 1 from storage.buckets where id = 'documentos') then
    raise exception 'security_activation_requires_documentos_bucket';
  end if;
end;
$$;

drop policy if exists "Permitir acesso total anonimo clientes" on public.clientes;
drop policy if exists "Permitir acesso total anonimo vendas" on public.vendas;
drop policy if exists "Permitir acesso total anonimo vendas_documentos" on public.vendas_documentos;
drop policy if exists "Acesso público total para documentos das vendas" on public.vendas_documentos;

drop policy if exists "Permitir acesso total anonimo storage" on storage.objects;
drop policy if exists "Permitir leitura dos documentos" on storage.objects;
drop policy if exists "Permitir novos documentos" on storage.objects;
drop policy if exists "Farmácias can delete their own folder" on storage.objects;
drop policy if exists "Farmácias can read their own folder" on storage.objects;
drop policy if exists "Farmácias can update their own folder" on storage.objects;
drop policy if exists "Farmácias can upload to their own folder" on storage.objects;

revoke all on public.clientes from anon;
revoke all on public.vendas from anon;
revoke all on public.vendas_documentos from anon;

update storage.buckets
set public = false
where id = 'documentos';

commit;
