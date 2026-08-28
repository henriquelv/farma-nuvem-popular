/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getSupabase } from './lib/supabase';
import SupabaseSetup from './components/SupabaseSetup';
import Layout from './components/Layout';
import ClientManagement from './components/ClientManagement';
import ClientProfile from './components/ClientProfile';
import Admin from './components/Admin';
import BIVendasHoje from './components/bi/VendasHoje';
import BICupons from './components/bi/Cupons';
import BIHistorico from './components/bi/Historico';
import Login from './components/Login';
import AccessDenied from './components/AccessDenied';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import PasswordResetRequest from './components/PasswordResetRequest';
import NewPassword from './components/NewPassword';

export default function App() {
  const [isSetup, setIsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSetup = () => {
      const supabase = getSupabase();
      setIsSetup(!!supabase);
      setLoading(false);
    };
    checkSetup();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isSetup) {
    if (import.meta.env.PROD) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
          <div className="max-w-md rounded-lg border border-red-100 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-black text-slate-900">Banco indisponível</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              A configuração pública do Supabase não foi carregada neste deploy. Avise o administrador do sistema.
            </p>
          </div>
        </div>
      );
    }
    return <SupabaseSetup onSetupComplete={() => setIsSetup(true)} />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/recuperar-senha" element={<PasswordResetRequest />} />
          <Route path="/nova-senha" element={<NewPassword />} />
          <Route path="/sem-acesso" element={<AccessDenied />} />
          <Route element={<ProtectedRoute roles={['admin', 'atendente']} />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/clientes" replace />} />
              <Route path="clientes" element={<ClientManagement />} />
              <Route path="clientes/:id" element={<ClientProfile />} />
              <Route element={<ProtectedRoute roles={['admin']} />}>
                <Route path="admin" element={<Admin />} />
                <Route path="bi/vendas-hoje" element={<BIVendasHoje />} />
                <Route path="bi/cupons" element={<BICupons />} />
                <Route path="bi/historico" element={<BIHistorico />} />
              </Route>
              <Route path="*" element={<Navigate to="/clientes" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
