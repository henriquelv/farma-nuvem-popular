begin;

do $$
begin
  if not exists (
    select 1
    from public.user_profiles as profile
    join public.farmacias as farmacia on farmacia.id = profile.farmacia_id
    where profile.role = 'admin' and profile.active = true and farmacia.active = true
  ) then
    raise exception 'security_activation_requires_active_admin';
  end if;

  if not exists (select 1 from storage.buckets where id = 'documentos') then
    raise exception 'security_activation_requires_documentos_bucket';
  end if;

  if exists (select 1 from public.clientes where farmacia_id is null)
    or exists (select 1 from public.vendas where farmacia_id is null)
    or exists (select 1 from public.vendas_documentos where farmacia_id is null) then
    raise exception 'security_activation_requires_complete_pharmacy_backfill';
  end if;
end;
$$;

drop policy if exists "Permitir acesso total anonimo clientes" on public.clientes;
drop policy if exists "Permitir acesso total anonimo vendas" on public.vendas;
drop policy if exists "Permitir acesso total anonimo vendas_documentos" on public.vendas_documentos;
drop policy if exists "Acesso público total para documentos das vendas" on public.vendas_documentos;
drop policy if exists "Farmácias can read own data" on public.farmacias;
drop policy if exists emergency_anon_clientes on public.clientes;
drop policy if exists emergency_anon_vendas on public.vendas;
drop policy if exists emergency_anon_vendas_documentos on public.vendas_documentos;

drop policy if exists "Permitir acesso total anonimo storage" on storage.objects;
drop policy if exists "Permitir leitura dos documentos" on storage.objects;
drop policy if exists "Permitir novos documentos" on storage.objects;
drop policy if exists "Farmácias can delete their own folder" on storage.objects;
drop policy if exists "Farmácias can read their own folder" on storage.objects;
drop policy if exists "Farmácias can update their own folder" on storage.objects;
drop policy if exists "Farmácias can upload to their own folder" on storage.objects;
drop policy if exists emergency_anon_documentos_select on storage.objects;
drop policy if exists emergency_anon_documentos_insert on storage.objects;

revoke all on public.clientes from anon;
revoke all on public.vendas from anon;
revoke all on public.vendas_documentos from anon;
revoke all on public.farmacias from anon;
revoke all on public.user_profiles from anon;

update storage.buckets
set public = false
where id = 'documentos';

commit;
