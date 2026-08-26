alter table public.clientes
  drop constraint if exists clientes_cpf_valid_check;

update public.clientes
set nome_completo = upper(nome_completo)
where nome_completo <> upper(nome_completo);

alter table public.clientes
  add constraint clientes_cpf_valid_check
  check (public.is_valid_cpf(cpf)) not valid;

alter table public.clientes
  add constraint clientes_nome_uppercase_check
  check (nome_completo = upper(nome_completo)) not valid;
