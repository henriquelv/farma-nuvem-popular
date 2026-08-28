select id, public
from storage.buckets
where id = 'documentos';

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename in ('clientes', 'vendas', 'vendas_documentos', 'user_profiles', 'farmacias'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select role, active, count(*) as users
from public.user_profiles
group by role, active
order by role, active;

select
  has_table_privilege('anon', 'public.clientes', 'select') as anon_clientes_select,
  has_table_privilege('anon', 'public.vendas', 'select') as anon_vendas_select,
  has_table_privilege('anon', 'public.vendas_documentos', 'select') as anon_documentos_select;

select
  (select count(*) from public.clientes where farmacia_id is null) as clientes_sem_farmacia,
  (select count(*) from public.vendas where farmacia_id is null) as vendas_sem_farmacia,
  (select count(*) from public.vendas_documentos where farmacia_id is null) as documentos_sem_farmacia;

select count(*) as vendas_cruzando_farmacias
from public.vendas as venda
join public.clientes as cliente on cliente.id = venda.cliente_id
where venda.farmacia_id <> cliente.farmacia_id;

select count(*) as documentos_cruzando_farmacias
from public.vendas_documentos as documento
left join public.clientes as cliente on cliente.id = documento.cliente_id
left join public.vendas as venda on venda.id = documento.venda_id
where (cliente.id is not null and documento.farmacia_id <> cliente.farmacia_id)
   or (venda.id is not null and documento.farmacia_id <> venda.farmacia_id);
