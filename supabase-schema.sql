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

-- Estabelecimentos isolados (uma conta compartilhada por farmacia)
CREATE TABLE public.farmacias (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome TEXT NOT NULL CHECK (length(btrim(nome)) >= 3),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9._-]{2,49}$'),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 1. Criação da tabela de Clientes
CREATE TABLE public.clientes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    farmacia_id UUID NOT NULL REFERENCES public.farmacias(id) ON DELETE RESTRICT,
    nome_completo TEXT NOT NULL CHECK (length(btrim(nome_completo)) >= 3),
    cpf TEXT NOT NULL CHECK (public.is_valid_cpf(cpf)),
    data_nascimento DATE NOT NULL CHECK (data_nascimento BETWEEN DATE '1900-01-01' AND CURRENT_DATE),
    url_identidade_frontal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (farmacia_id, cpf),
    UNIQUE (farmacia_id, id)
);

-- 2. Criação da tabela de Vendas
CREATE TABLE public.vendas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    farmacia_id UUID NOT NULL REFERENCES public.farmacias(id) ON DELETE RESTRICT,
    cliente_id UUID,
    data_venda TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    nome_medicamento TEXT,
    valor NUMERIC(10, 2),
    url_receita TEXT,
    url_cupom_fiscal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (farmacia_id, id),
    FOREIGN KEY (farmacia_id, cliente_id) REFERENCES public.clientes(farmacia_id, id) ON DELETE CASCADE
);

-- 3. Criação da tabela de Documentos das Vendas
CREATE TABLE public.vendas_documentos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    farmacia_id UUID NOT NULL REFERENCES public.farmacias(id) ON DELETE RESTRICT,
    venda_id UUID,
    cliente_id UUID,
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'cupom', 'identidade', 'documento', 'procuracao')),
    url TEXT NOT NULL,
    -- Para receitas, nome_arquivo pode conter META::JSON com nome, data de inicio e vencimento.
    -- Receitas antigas nao devem ser apagadas; elas compoem historico fiscal do cliente.
    nome_arquivo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    FOREIGN KEY (farmacia_id, venda_id) REFERENCES public.vendas(farmacia_id, id) ON DELETE CASCADE,
    FOREIGN KEY (farmacia_id, cliente_id) REFERENCES public.clientes(farmacia_id, id) ON DELETE CASCADE
);

-- 4. Perfis de acesso vinculados ao Supabase Auth
CREATE TABLE public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
    farmacia_id UUID NOT NULL REFERENCES public.farmacias(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL CHECK (length(btrim(full_name)) >= 3),
    role TEXT NOT NULL CHECK (role IN ('admin', 'atendente')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE OR REPLACE FUNCTION public.current_farmacia_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT profile.farmacia_id
    FROM public.user_profiles AS profile
    JOIN public.farmacias AS farmacia ON farmacia.id = profile.farmacia_id
    WHERE profile.id = auth.uid() AND profile.active = TRUE AND farmacia.active = TRUE
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT profile.role FROM public.user_profiles AS profile
    JOIN public.farmacias AS farmacia ON farmacia.id = profile.farmacia_id
    WHERE profile.id = auth.uid() AND profile.active = TRUE AND farmacia.active = TRUE
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_active_app_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT public.current_app_role() IN ('admin', 'atendente') $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT public.current_app_role() = 'admin' $$;

ALTER TABLE public.clientes ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id();
ALTER TABLE public.vendas ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id();
ALTER TABLE public.vendas_documentos ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id();

CREATE OR REPLACE FUNCTION public.rollback_empty_recent_client(target_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT public.is_active_app_user() THEN
        RAISE EXCEPTION 'app_user_not_authorized' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.clientes
    WHERE id = target_id
      AND farmacia_id = public.current_farmacia_id()
      AND created_at >= now() - INTERVAL '15 minutes'
      AND NOT EXISTS (SELECT 1 FROM public.vendas WHERE cliente_id = target_id)
      AND NOT EXISTS (SELECT 1 FROM public.vendas_documentos WHERE cliente_id = target_id);
    RETURN FOUND;
END;
$$;

-- 5. Storage privado
INSERT INTO storage.buckets (id, name, public) VALUES ('documentos', 'documentos', false);

CREATE OR REPLACE FUNCTION public.can_read_document_path(object_name TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, storage, pg_temp
AS $$ SELECT public.is_active_app_user() AND object_name LIKE public.current_farmacia_id()::TEXT || '/%' $$;

CREATE OR REPLACE FUNCTION public.can_write_document_path(object_name TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, storage, pg_temp
AS $$ SELECT public.is_active_app_user() AND object_name LIKE public.current_farmacia_id()::TEXT || '/%' $$;

-- 6. Políticas de Segurança (RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farmacias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_select_own ON public.user_profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY user_profiles_admin_all ON public.user_profiles FOR ALL TO authenticated USING (farmacia_id = public.current_farmacia_id() AND public.is_admin()) WITH CHECK (farmacia_id = public.current_farmacia_id() AND public.is_admin());
CREATE POLICY farmacias_select_own ON public.farmacias FOR SELECT TO authenticated USING (id = public.current_farmacia_id());

CREATE POLICY clientes_authenticated_select ON public.clientes FOR SELECT TO authenticated USING (farmacia_id = public.current_farmacia_id());
CREATE POLICY clientes_authenticated_insert ON public.clientes FOR INSERT TO authenticated WITH CHECK (farmacia_id = public.current_farmacia_id());
CREATE POLICY clientes_admin_update ON public.clientes FOR UPDATE TO authenticated USING (farmacia_id = public.current_farmacia_id() AND public.is_admin()) WITH CHECK (farmacia_id = public.current_farmacia_id() AND public.is_admin());
CREATE POLICY clientes_admin_delete ON public.clientes FOR DELETE TO authenticated USING (farmacia_id = public.current_farmacia_id() AND public.is_admin());

CREATE POLICY vendas_authenticated_select ON public.vendas FOR SELECT TO authenticated USING (farmacia_id = public.current_farmacia_id());
CREATE POLICY vendas_authenticated_insert ON public.vendas FOR INSERT TO authenticated WITH CHECK (farmacia_id = public.current_farmacia_id());

CREATE POLICY vendas_documentos_authenticated_select ON public.vendas_documentos FOR SELECT TO authenticated USING (farmacia_id = public.current_farmacia_id());
CREATE POLICY vendas_documentos_authenticated_insert ON public.vendas_documentos FOR INSERT TO authenticated WITH CHECK (farmacia_id = public.current_farmacia_id());

CREATE POLICY documentos_authenticated_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documentos' AND public.can_read_document_path(name));
CREATE POLICY documentos_authenticated_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documentos' AND public.can_write_document_path(name));

-- 7. Índices de Performance
CREATE INDEX IF NOT EXISTS idx_vendas_data_venda ON public.vendas(data_venda);
CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON public.clientes(cpf);
CREATE INDEX IF NOT EXISTS idx_clientes_farmacia_id ON public.clientes(farmacia_id);
CREATE INDEX IF NOT EXISTS idx_vendas_farmacia_id ON public.vendas(farmacia_id);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_farmacia_id ON public.vendas_documentos(farmacia_id);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_venda_id ON public.vendas_documentos(venda_id);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_cliente_id ON public.vendas_documentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_documentos_tipo ON public.vendas_documentos(tipo);
