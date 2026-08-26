begin;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) >= 3),
  role text not null check (role in ('admin', 'atendente')),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.touch_user_profile_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute function public.touch_user_profile_updated_at();

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select role
  from public.user_profiles
  where id = auth.uid() and active = true
  limit 1
$$;

create or replace function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.current_app_role() in ('admin', 'atendente')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.current_app_role() = 'admin'
$$;

create or replace function public.rollback_empty_recent_client(target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_active_app_user() then
    raise exception 'app_user_not_authorized' using errcode = '42501';
  end if;

  delete from public.clientes
  where id = target_id
    and created_at >= now() - interval '15 minutes'
    and not exists (select 1 from public.vendas where cliente_id = target_id)
    and not exists (select 1 from public.vendas_documentos where cliente_id = target_id);

  return found;
end;
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.is_active_app_user() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_app_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.rollback_empty_recent_client(uuid) from public;
grant execute on function public.rollback_empty_recent_client(uuid) to authenticated;

alter table public.user_profiles enable row level security;
alter table public.clientes enable row level security;
alter table public.vendas enable row level security;
alter table public.vendas_documentos enable row level security;

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own
on public.user_profiles for select to authenticated
using (id = auth.uid());

drop policy if exists user_profiles_admin_all on public.user_profiles;
create policy user_profiles_admin_all
on public.user_profiles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists clientes_authenticated_select on public.clientes;
create policy clientes_authenticated_select
on public.clientes for select to authenticated
using (public.is_active_app_user());

drop policy if exists clientes_authenticated_insert on public.clientes;
create policy clientes_authenticated_insert
on public.clientes for insert to authenticated
with check (public.is_active_app_user());

drop policy if exists clientes_admin_update on public.clientes;
create policy clientes_admin_update
on public.clientes for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists clientes_admin_delete on public.clientes;
create policy clientes_admin_delete
on public.clientes for delete to authenticated
using (public.is_admin());

drop policy if exists vendas_authenticated_select on public.vendas;
create policy vendas_authenticated_select
on public.vendas for select to authenticated
using (public.is_active_app_user());

drop policy if exists vendas_authenticated_insert on public.vendas;
create policy vendas_authenticated_insert
on public.vendas for insert to authenticated
with check (public.is_active_app_user());

drop policy if exists vendas_documentos_authenticated_select on public.vendas_documentos;
create policy vendas_documentos_authenticated_select
on public.vendas_documentos for select to authenticated
using (public.is_active_app_user());

drop policy if exists vendas_documentos_authenticated_insert on public.vendas_documentos;
create policy vendas_documentos_authenticated_insert
on public.vendas_documentos for insert to authenticated
with check (public.is_active_app_user());

drop policy if exists documentos_authenticated_select on storage.objects;
create policy documentos_authenticated_select
on storage.objects for select to authenticated
using (bucket_id = 'documentos' and public.is_active_app_user());

drop policy if exists documentos_authenticated_insert on storage.objects;
create policy documentos_authenticated_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'documentos' and public.is_active_app_user());

grant select on public.user_profiles to authenticated;
grant select, insert, update, delete on public.clientes to authenticated;
grant select, insert on public.vendas to authenticated;
grant select, insert on public.vendas_documentos to authenticated;

commit;
