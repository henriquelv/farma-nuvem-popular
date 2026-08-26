begin;

create or replace function public.is_valid_cpf(value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
  total integer := 0;
  expected integer;
  i integer;
begin
  if length(digits) <> 11 or digits = repeat(substr(digits, 1, 1), 11) then
    return false;
  end if;

  for i in 1..9 loop
    total := total + substr(digits, i, 1)::integer * (11 - i);
  end loop;
  expected := (total * 10) % 11;
  if expected = 10 then expected := 0; end if;
  if expected <> substr(digits, 10, 1)::integer then return false; end if;

  total := 0;
  for i in 1..10 loop
    total := total + substr(digits, i, 1)::integer * (12 - i);
  end loop;
  expected := (total * 10) % 11;
  if expected = 10 then expected := 0; end if;

  return expected = substr(digits, 11, 1)::integer;
end;
$$;

alter table public.clientes
  add constraint clientes_nome_not_blank_check
  check (length(btrim(nome_completo)) >= 3) not valid;

alter table public.clientes
  add constraint clientes_cpf_valid_check
  check (public.is_valid_cpf(cpf)) not valid;

alter table public.clientes
  add constraint clientes_nascimento_valid_check
  check (data_nascimento between date '1900-01-01' and current_date) not valid;

alter table public.vendas
  add constraint vendas_medicamento_not_blank_check
  check (length(btrim(nome_medicamento)) > 0) not valid;

alter table public.vendas
  add constraint vendas_valor_positive_check
  check (valor > 0) not valid;

commit;
