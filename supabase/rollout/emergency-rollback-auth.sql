begin;

update storage.buckets set public = true where id = 'documentos';

grant select, insert, update, delete on public.clientes to anon;
grant select, insert, update, delete on public.vendas to anon;
grant select, insert, update, delete on public.vendas_documentos to anon;

drop policy if exists emergency_anon_clientes on public.clientes;
create policy emergency_anon_clientes on public.clientes
for all to anon using (true) with check (true);

drop policy if exists emergency_anon_vendas on public.vendas;
create policy emergency_anon_vendas on public.vendas
for all to anon using (true) with check (true);

drop policy if exists emergency_anon_vendas_documentos on public.vendas_documentos;
create policy emergency_anon_vendas_documentos on public.vendas_documentos
for all to anon using (true) with check (true);

drop policy if exists emergency_anon_documentos_select on storage.objects;
create policy emergency_anon_documentos_select on storage.objects
for select to anon using (bucket_id = 'documentos');

drop policy if exists emergency_anon_documentos_insert on storage.objects;
create policy emergency_anon_documentos_insert on storage.objects
for insert to anon with check (bucket_id = 'documentos');

commit;
