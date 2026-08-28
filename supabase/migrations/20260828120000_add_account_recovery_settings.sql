begin;

alter table public.farmacias
  add column if not exists recovery_email text,
  add column if not exists recovery_email_updated_at timestamptz;

alter table public.farmacias drop constraint if exists farmacias_recovery_email_check;
alter table public.farmacias add constraint farmacias_recovery_email_check
check (
  recovery_email is null
  or recovery_email ~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
) not valid;

create or replace function public.update_own_recovery_email(new_email text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  normalized_email text := lower(btrim(coalesce(new_email, '')));
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if length(normalized_email) > 254
    or normalized_email !~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'invalid_recovery_email' using errcode = '22023';
  end if;

  update public.farmacias
  set recovery_email = normalized_email,
      recovery_email_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = public.current_farmacia_id()
  returning recovery_email into normalized_email;

  if not found then
    raise exception 'pharmacy_not_found' using errcode = '42501';
  end if;

  return normalized_email;
end;
$$;

revoke all on function public.update_own_recovery_email(text) from public;
grant execute on function public.update_own_recovery_email(text) to authenticated;

commit;

