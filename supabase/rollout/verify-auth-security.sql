select id, public
from storage.buckets
where id = 'documentos';

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename in ('clientes', 'vendas', 'vendas_documentos', 'user_profiles'))
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
