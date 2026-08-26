alter table public.vendas
  alter column nome_medicamento drop not null,
  alter column valor drop not null;

alter table public.vendas
  drop constraint if exists vendas_medicamento_not_blank_check,
  drop constraint if exists vendas_valor_positive_check;

comment on column public.vendas.nome_medicamento is
  'Campo legado opcional; novos registros fiscais não exigem descrição do produto.';

comment on column public.vendas.valor is
  'Campo legado opcional; novos registros fiscais não exigem valor da compra.';
