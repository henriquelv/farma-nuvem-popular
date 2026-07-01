import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, CheckCircle, AlertTriangle, FileWarning } from 'lucide-react';
import { getSupabase } from '../../lib/supabase';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from 'motion/react';

export default function BICupons() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, comCupom: 0, semCupom: 0, comReceita: 0, semReceita: 0 });

  useEffect(() => {
    const fetchData = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: vendas, error } = await supabase
          .from('vendas')
          .select('id');

        if (error) throw error;

        const total = vendas.length;
        const vendaIds = vendas.map(v => v.id);
        let comCupom = 0;
        if (vendaIds.length) {
          const { data: docs, error: docsError } = await supabase
            .from('vendas_documentos')
            .select('venda_id,tipo')
            .in('venda_id', vendaIds);
          if (docsError) throw docsError;
          comCupom = new Set((docs || []).filter(d => d.tipo === 'cupom').map(d => d.venda_id)).size;
        }
        const semCupom = total - comCupom;
        const comReceita = total;
        const semReceita = 0;

        setStats({ total, comCupom, semCupom, comReceita, semReceita });

        setData([
          { name: 'Com Cupom', value: comCupom, color: '#10b981' },
          { name: 'Sem Cupom', value: semCupom, color: '#ef4444' }
        ]);

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-7xl mx-auto"
    >
      <button
        onClick={() => navigate('/')}
        className="text-slate-500 hover:text-slate-800 flex items-center gap-2 transition-colors font-medium bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100 w-fit"
      >
        <ArrowLeft size={20} />
        <span>Voltar ao Dashboard</span>
      </button>

      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
          <div className="bg-emerald-500 text-white p-2 rounded-xl shadow-lg shadow-emerald-500/20">
            <FileText size={28} />
          </div>
          BI: Compliance e Documentos
        </h1>
        <p className="text-slate-500 mt-2 text-lg">Análise de anexação de cupons fiscais e receitas médicas.</p>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <CheckCircle className="text-emerald-500" />
              Taxa de Compliance (Cupons)
            </h2>
            <div className="h-80 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none pb-8">
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Total</p>
                  <p className="text-4xl font-black text-slate-800">{stats.total}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-emerald-50 opacity-50">
                <FileText size={120} />
              </div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Receitas Anexadas</h3>
              <div className="flex items-end gap-4 relative z-10">
                <p className="text-5xl font-black text-slate-900">{stats.comReceita}</p>
                <p className="text-lg font-medium text-emerald-500 mb-1">
                  {stats.total > 0 ? Math.round((stats.comReceita / stats.total) * 100) : 0}% do total
                </p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-red-50 opacity-50">
                <FileWarning size={120} />
              </div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10 flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                Pendências Críticas (Sem Cupom)
              </h3>
              <div className="flex items-end gap-4 relative z-10">
                <p className="text-5xl font-black text-red-500">{stats.semCupom}</p>
                <p className="text-lg font-medium text-slate-500 mb-1">
                  vendas requerem atenção
                </p>
              </div>
              {stats.semCupom > 0 && (
                <button 
                  onClick={() => navigate('/clientes')}
                  className="mt-6 w-full py-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-xl transition-colors"
                >
                  Auditar Pendências
                </button>
              )}
            </div>
          </div>

        </div>
      )}
    </motion.div>
  );
}
