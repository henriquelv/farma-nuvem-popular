create unique index if not exists clientes_cpf_unique_idx
  on public.clientes (cpf);

alter table public.clientes
  add constraint clientes_nome_format_check
  check (
    nome_completo !~ '[0-9,]'
    and nome_completo !~ '  +'
  ) not valid;
