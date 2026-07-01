import React, { useState } from 'react';
import { setSupabaseCredentials } from '../lib/supabase';
import { Database, KeyRound, AlertCircle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

export default function SupabaseSetup({ onSetupComplete }: { onSetupComplete: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !key) {
      setError('Por favor, preencha ambos os campos.');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // Basic validation
      new URL(url);
      
      // Test connection
      const tempClient = createClient(url, key);
      const { error: testError } = await tempClient.from('clientes').select('id').limit(1);
      
      if (testError) {
        if (testError.message === 'Failed to fetch') {
          throw new Error('Falha na conexão (Failed to fetch). Verifique se a URL está correta e se o seu projeto Supabase está ativo.');
        }
        // If the error is that the table doesn't exist (42P01), the connection worked!
        if (testError.code !== '42P01') {
           console.warn('Supabase connection test warning:', testError);
        }
      }

      setSupabaseCredentials(url, key);
      onSetupComplete();
    } catch (err: any) {
      setError(err.message || 'URL inválida. Certifique-se de que começa com https:// e é um projeto Supabase válido.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 border border-slate-100">
        <div className="text-center mb-8">
          <div className="bg-blue-100 text-blue-600 p-3 rounded-full inline-block mb-4">
            <Database size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Configuração do Supabase</h1>
          <p className="text-slate-500 mt-2 text-sm">
            Para testar este MVP, insira as credenciais do seu projeto Supabase.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg flex items-center gap-2 mb-6 text-sm">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Supabase Project URL
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Database size={16} />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://xyzcompany.supabase.co"
                className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Supabase Anon Key
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <KeyRound size={16} />
              </div>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors mt-6 flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Conectando...
              </>
            ) : (
              'Conectar ao Banco de Dados'
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 text-xs text-slate-500">
          <p>
            <strong>Nota:</strong> As credenciais serão salvas apenas no seu navegador (localStorage) para fins de demonstração.
          </p>
        </div>
      </div>
    </div>
  );
}

