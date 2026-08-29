begin;

create table if not exists public.password_recovery_attempts (
  id bigint generated always as identity primary key,
  identity_hash text not null,
  source_hash text not null,
  attempted_at timestamptz not null default timezone('utc', now())
);

create index if not exists password_recovery_attempts_identity_idx
  on public.password_recovery_attempts (identity_hash, attempted_at desc);
create index if not exists password_recovery_attempts_source_idx
  on public.password_recovery_attempts (source_hash, attempted_at desc);

alter table public.password_recovery_attempts enable row level security;
revoke all on table public.password_recovery_attempts from public, anon, authenticated;

create or replace function public.consume_password_recovery_attempt(
  requested_identity_hash text,
  requested_source_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  recent_identity_attempts integer;
  recent_source_attempts integer;
begin
  if length(requested_identity_hash) <> 64 or length(requested_source_hash) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(requested_identity_hash, requested_source_hash), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(requested_identity_hash, requested_source_hash), 0));

  delete from public.password_recovery_attempts
  where attempted_at < timezone('utc', now()) - interval '24 hours';

  select count(*) into recent_identity_attempts
  from public.password_recovery_attempts
  where identity_hash = requested_identity_hash
    and attempted_at >= timezone('utc', now()) - interval '15 minutes';

  select count(*) into recent_source_attempts
  from public.password_recovery_attempts
  where source_hash = requested_source_hash
    and attempted_at >= timezone('utc', now()) - interval '15 minutes';

  if recent_identity_attempts >= 5 or recent_source_attempts >= 20 then
    return false;
  end if;

  insert into public.password_recovery_attempts (identity_hash, source_hash)
  values (requested_identity_hash, requested_source_hash);

  return true;
end;
$$;

revoke all on function public.consume_password_recovery_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_password_recovery_attempt(text, text) to service_role;

commit;
