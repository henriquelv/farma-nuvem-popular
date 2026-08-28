begin;

-- O trigger legado criava uma farmacia incompleta a cada usuario Auth.
-- O provisionador administrativo passa a ser o unico fluxo de criacao.
drop trigger if exists on_auth_user_created on auth.users;

create table if not exists public.farmacias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) >= 3),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9._-]{2,49}$'),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Compatibilidade com a tabela farmacias de versões antigas.
alter table public.farmacias add column if not exists nome text;
alter table public.farmacias add column if not exists slug text;
alter table public.farmacias add column if not exists active boolean default true;
alter table public.farmacias add column if not exists created_at timestamptz default timezone('utc', now());
alter table public.farmacias add column if not exists updated_at timestamptz default timezone('utc', now());

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'farmacias' and column_name = 'nome_fantasia'
  ) then
    execute 'update public.farmacias set nome = coalesce(nome, nullif(btrim(nome_fantasia), ''''))';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'farmacias' and column_name = 'criado_em'
  ) then
    execute 'update public.farmacias set created_at = coalesce(criado_em, created_at)';
  end if;
end;
$$;

update public.farmacias
set nome = coalesce(nome, 'FARMACIA ' || upper(substr(replace(id::text, '-', ''), 1, 8))),
    slug = coalesce(slug, 'farmacia-' || lower(substr(replace(id::text, '-', ''), 1, 12))),
    active = coalesce(active, true),
    created_at = coalesce(created_at, timezone('utc', now())),
    updated_at = coalesce(updated_at, timezone('utc', now()));

alter table public.farmacias alter column nome set not null;
alter table public.farmacias alter column slug set not null;
alter table public.farmacias alter column active set not null;
alter table public.farmacias alter column created_at set not null;
alter table public.farmacias alter column updated_at set not null;
create unique index if not exists farmacias_slug_unique_idx on public.farmacias(slug);

alter table public.farmacias drop constraint if exists farmacias_nome_check;
alter table public.farmacias add constraint farmacias_nome_check check (length(btrim(nome)) >= 3) not valid;
alter table public.farmacias drop constraint if exists farmacias_slug_check;
alter table public.farmacias add constraint farmacias_slug_check check (slug ~ '^[a-z0-9][a-z0-9._-]{2,49}$') not valid;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'farmacias' and column_name = 'nome_fantasia'
  ) then
    execute 'alter table public.farmacias alter column nome_fantasia drop not null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'farmacias' and column_name = 'cnpj'
  ) then
    execute 'alter table public.farmacias alter column cnpj drop not null';
  end if;
end;
$$;

-- ID fixo para preservar e identificar com seguranca todos os dados anteriores ao multi-tenant.
insert into public.farmacias (id, nome, slug, active)
values ('00000000-0000-4000-8000-000000000001', 'FARMACIA PRINCIPAL', 'farmacia-principal', true)
on conflict (id) do nothing;

alter table public.user_profiles
  add column if not exists farmacia_id uuid references public.farmacias(id) on delete restrict;
update public.user_profiles
set farmacia_id = '00000000-0000-4000-8000-000000000001'
where farmacia_id is null;
alter table public.user_profiles alter column farmacia_id set not null;

-- O default fixo faz o backfill sem disparar os bloqueios de auditoria existentes.
alter table public.clientes
  add column if not exists farmacia_id uuid not null
  default '00000000-0000-4000-8000-000000000001'
  references public.farmacias(id) on delete restrict;
alter table public.vendas
  add column if not exists farmacia_id uuid not null
  default '00000000-0000-4000-8000-000000000001'
  references public.farmacias(id) on delete restrict;
alter table public.vendas_documentos
  add column if not exists farmacia_id uuid not null
  default '00000000-0000-4000-8000-000000000001'
  references public.farmacias(id) on delete restrict;

create or replace function public.current_farmacia_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select profile.farmacia_id
  from public.user_profiles as profile
  join public.farmacias as farmacia on farmacia.id = profile.farmacia_id
  where profile.id = auth.uid()
    and profile.active = true
    and farmacia.active = true
  limit 1
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select profile.role
  from public.user_profiles as profile
  join public.farmacias as farmacia on farmacia.id = profile.farmacia_id
  where profile.id = auth.uid()
    and profile.active = true
    and farmacia.active = true
  limit 1
$$;

create or replace function public.can_read_document_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  select public.is_active_app_user()
    and (
      object_name like public.current_farmacia_id()::text || '/%'
      or (
        public.current_farmacia_id() = '00000000-0000-4000-8000-000000000001'::uuid
        and split_part(object_name, '/', 1) in (
          'cadastros', 'cupom', 'receita', 'identidades', 'documentos', 'procuracao'
        )
      )
    )
$$;

create or replace function public.can_write_document_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  select public.is_active_app_user()
    and object_name like public.current_farmacia_id()::text || '/%'
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
    and farmacia_id = public.current_farmacia_id()
    and created_at >= now() - interval '15 minutes'
    and not exists (select 1 from public.vendas where cliente_id = target_id)
    and not exists (select 1 from public.vendas_documentos where cliente_id = target_id);

  return found;
end;
$$;

revoke all on function public.current_farmacia_id() from public;
revoke all on function public.can_read_document_path(text) from public;
revoke all on function public.can_write_document_path(text) from public;
grant execute on function public.current_farmacia_id() to authenticated;
grant execute on function public.can_read_document_path(text) to authenticated;
grant execute on function public.can_write_document_path(text) to authenticated;

alter table public.clientes alter column farmacia_id set default public.current_farmacia_id();
alter table public.vendas alter column farmacia_id set default public.current_farmacia_id();
alter table public.vendas_documentos alter column farmacia_id set default public.current_farmacia_id();

alter table public.clientes drop constraint if exists clientes_cpf_key;
drop index if exists public.clientes_cpf_unique_idx;
create unique index if not exists clientes_farmacia_cpf_unique_idx
  on public.clientes (farmacia_id, cpf);

create unique index if not exists clientes_farmacia_id_id_unique_idx
  on public.clientes (farmacia_id, id);
create unique index if not exists vendas_farmacia_id_id_unique_idx
  on public.vendas (farmacia_id, id);

alter table public.vendas drop constraint if exists vendas_cliente_id_fkey;
alter table public.vendas
  add constraint vendas_farmacia_cliente_fkey
  foreign key (farmacia_id, cliente_id)
  references public.clientes(farmacia_id, id) on delete cascade;

alter table public.vendas_documentos drop constraint if exists vendas_documentos_cliente_id_fkey;
alter table public.vendas_documentos drop constraint if exists vendas_documentos_venda_id_fkey;
alter table public.vendas_documentos
  add constraint vendas_documentos_farmacia_cliente_fkey
  foreign key (farmacia_id, cliente_id)
  references public.clientes(farmacia_id, id) on delete cascade;
alter table public.vendas_documentos
  add constraint vendas_documentos_farmacia_venda_fkey
  foreign key (farmacia_id, venda_id)
  references public.vendas(farmacia_id, id) on delete cascade;

alter table public.farmacias enable row level security;

drop policy if exists user_profiles_admin_all on public.user_profiles;
create policy user_profiles_admin_all
on public.user_profiles for all to authenticated
using (farmacia_id = public.current_farmacia_id() and public.is_admin())
with check (farmacia_id = public.current_farmacia_id() and public.is_admin());

drop policy if exists farmacias_select_own on public.farmacias;
create policy farmacias_select_own
on public.farmacias for select to authenticated
using (id = public.current_farmacia_id());

drop policy if exists clientes_authenticated_select on public.clientes;
create policy clientes_authenticated_select
on public.clientes for select to authenticated
using (farmacia_id = public.current_farmacia_id());

drop policy if exists clientes_authenticated_insert on public.clientes;
create policy clientes_authenticated_insert
on public.clientes for insert to authenticated
with check (farmacia_id = public.current_farmacia_id());

drop policy if exists clientes_admin_update on public.clientes;
create policy clientes_admin_update
on public.clientes for update to authenticated
using (farmacia_id = public.current_farmacia_id() and public.is_admin())
with check (farmacia_id = public.current_farmacia_id() and public.is_admin());

drop policy if exists clientes_admin_delete on public.clientes;
create policy clientes_admin_delete
on public.clientes for delete to authenticated
using (farmacia_id = public.current_farmacia_id() and public.is_admin());

drop policy if exists vendas_authenticated_select on public.vendas;
create policy vendas_authenticated_select
on public.vendas for select to authenticated
using (farmacia_id = public.current_farmacia_id());

drop policy if exists vendas_authenticated_insert on public.vendas;
create policy vendas_authenticated_insert
on public.vendas for insert to authenticated
with check (farmacia_id = public.current_farmacia_id());

drop policy if exists vendas_documentos_authenticated_select on public.vendas_documentos;
create policy vendas_documentos_authenticated_select
on public.vendas_documentos for select to authenticated
using (farmacia_id = public.current_farmacia_id());

drop policy if exists vendas_documentos_authenticated_insert on public.vendas_documentos;
create policy vendas_documentos_authenticated_insert
on public.vendas_documentos for insert to authenticated
with check (farmacia_id = public.current_farmacia_id());

drop policy if exists documentos_authenticated_select on storage.objects;
create policy documentos_authenticated_select
on storage.objects for select to authenticated
using (bucket_id = 'documentos' and public.can_read_document_path(name));

drop policy if exists documentos_authenticated_insert on storage.objects;
create policy documentos_authenticated_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'documentos' and public.can_write_document_path(name));

grant select on public.farmacias to authenticated;

commit;
