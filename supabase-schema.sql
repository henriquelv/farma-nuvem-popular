-- Script SQL para o Supabase - Farmácia Popular MVP

CREATE OR REPLACE FUNCTION public.is_valid_cpf(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
    digits TEXT := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
    total INTEGER := 0;
    expected INTEGER;
    i INTEGER;
BEGIN
    IF length(digits) <> 11 OR digits = repeat(substr(digits, 1, 1), 11) THEN RETURN FALSE; END IF;
    FOR i IN 1..9 LOOP total := total + substr(digits, i, 1)::INTEGER * (11 - i); END LOOP;
    expected := (total * 10) % 11;
    IF expected = 10 THEN expected := 0; END IF;
    IF expected <> substr(digits, 10, 1)::INTEGER THEN RETURN FALSE; END IF;
    total := 0;
    FOR i IN 1..10 LOOP total := total + substr(digits, i, 1)::INTEGER * (12 - i); END LOOP;
    expected := (total * 10) % 11;
    IF expected = 10 THEN expected := 0; END IF;
    RETURN expected = substr(digits, 11, 1)::INTEGER;
END;
$$;

-- 1. Criação da tabela de Clientes
CREATE TABLE public.clientes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome_completo TEXT NOT NULL CHECK (length(btrim(nome_completo)) >= 3),
    cpf TEXT UNIQUE NOT NULL CHECK (public.is_valid_cpf(cpf)),
    data_nascimento DATE NOT NULL CHECK (data_nascimento BETWEEN DATE '1900-01-01' AND CURRENT_DATE),
    url_identidade_frontal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Criação da tabela de Vendas
CREATE TABLE public.vendas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    data_venda TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    nome_medicamento TEXT NOT NULL CHECK (length(btrim(nome_medicamento)) > 0),
    valor NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    url_receita TEXT,
    url_cupom_fiscal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Criação da tabela de Documentos das Vendas
CREATE TABLE public.vendas_documentos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    venda_id UUID REFERENCES public.vendas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'cupom', 'identidade', 'documento', 'procuracao')),
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
