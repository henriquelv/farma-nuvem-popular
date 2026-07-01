-- Script SQL para o Supabase - Farmácia Popular MVP

-- 1. Criação da tabela de Clientes
CREATE TABLE public.clientes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome_completo TEXT NOT NULL,
    cpf TEXT UNIQUE NOT NULL,
    data_nascimento DATE NOT NULL,
    url_identidade_frontal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Criação da tabela de Vendas
CREATE TABLE public.vendas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    data_venda TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    nome_medicamento TEXT NOT NULL,
    valor NUMERIC(10, 2) NOT NULL,
    url_receita TEXT,
    url_cupom_fiscal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Criação da tabela de Documentos das Vendas
CREATE TABLE public.vendas_documentos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    venda_id UUID REFERENCES public.vendas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'cupom', 'cpf')),
    url TEXT NOT NULL,
    -- Para receitas, nome_arquivo pode conter META::JSON com nome, data de inicio e vencimento.
    -- Receitas antigas nao devem ser apagadas; elas compoem historico fiscal do cliente.
    nome_arquivo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Configuração do Storage (Bucket para documentos)
INSERT INTO storage.buckets (id, name, public) VALUES ('documentos', 'documentos', true);

-- 5. Políticas de Segurança (RLS - Row Level Security)
-- ATENÇÃO: Para este MVP, estamos permitindo acesso total anônimo. 
-- Em produção, você DEVE restringir isso apenas para usuários autenticados.
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir acesso total anonimo clientes" ON public.clientes FOR ALL USING (true);
CREATE POLICY "Permitir acesso total anonimo vendas" ON public.vendas FOR ALL USING (true);
CREATE POLICY "Permitir acesso total anonimo vendas_documentos" ON public.vendas_documentos FOR ALL USING (true);

-- Política para o Storage
CREATE POLICY "Permitir acesso total anonimo storage" ON storage.objects FOR ALL USING (bucket_id = 'documentos');

-- 6. Índices de Performance
CREATE INDEX IF NOT EXISTS idx_vendas_data_venda ON public.vendas(data_venda);
CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON public.clientes(cpf);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_venda_id ON public.vendas_documentos(venda_id);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_cliente_id ON public.vendas_documentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_tipo ON public.vendas_documentos(tipo);
