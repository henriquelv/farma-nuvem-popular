/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getSupabase } from './lib/supabase';
import SupabaseSetup from './components/SupabaseSetup';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import ClientManagement from './components/ClientManagement';
import ClientProfile from './components/ClientProfile';
import Admin from './components/Admin';
import BIVendasHoje from './components/bi/VendasHoje';
import BICupons from './components/bi/Cupons';
import BIHistorico from './components/bi/Historico';

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
    return <SupabaseSetup onSetupComplete={() => setIsSetup(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="clientes" element={<ClientManagement />} />
          <Route path="clientes/:id" element={<ClientProfile />} />
          <Route path="admin" element={<Admin />} />
          <Route path="bi/vendas-hoje" element={<BIVendasHoje />} />
          <Route path="bi/cupons" element={<BICupons />} />
          <Route path="bi/historico" element={<BIHistorico />} />
<Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
