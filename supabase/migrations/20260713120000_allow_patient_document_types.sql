begin;

alter table public.vendas_documentos
  drop constraint if exists vendas_documentos_tipo_check;

alter table public.vendas_documentos
  add constraint vendas_documentos_tipo_check
  check (tipo in ('receita', 'cupom', 'identidade', 'documento', 'procuracao'));

commit;
