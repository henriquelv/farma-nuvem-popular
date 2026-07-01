import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Calendar, BarChart3 } from 'lucide-react';
import { getSupabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { motion } from 'motion/react';

export default function BIHistorico() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalVendas: 0, totalValor: 0, mediaMensal: 0 });

  useEffect(() => {
    const fetchData = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: vendas, error } = await supabase
          .from('vendas')
          .select('*')
          .order('data_venda', { ascending: true });

        if (error) throw error;

        if (!vendas || vendas.length === 0) {
          setLoading(false);
          return;
        }

        const totalVendas = vendas.length;
        const totalValor = vendas.reduce((acc, v) => acc + Number(v.valor), 0);

        // Group by Month/Year
        const monthMap = new Map();
        vendas.forEach(v => {
          const date = parseISO(v.data_venda);
          const monthKey = format(date, 'MMM/yy', { locale: ptBR });
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { mes: monthKey, valor: 0, qtd: 0 });
          }
          const current = monthMap.get(monthKey);
          current.valor += Number(v.valor);
          current.qtd += 1;
        });

        const chartData = Array.from(monthMap.values());
        setMonthlyData(chartData);

        setStats({
          totalVendas,
          totalValor,
          mediaMensal: chartData.length > 0 ? totalValor / chartData.length : 0
        });

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
          <div className="bg-indigo-600 text-white p-2 rounded-xl shadow-lg shadow-indigo-600/20">
            <TrendingUp size={28} />
          </div>
          BI: Histórico Geral
        </h1>
        <p className="text-slate-500 mt-2 text-lg">Visão macro do crescimento e tendências de longo prazo.</p>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-indigo-50 opacity-50">
                <BarChart3 size={120} />
              </div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Total Histórico</p>
              <p className="text-4xl font-black text-slate-900 relative z-10">{stats.totalVendas} <span className="text-xl text-slate-400 font-medium">vendas</span></p>
            </div>
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-indigo-50 opacity-50">
                <TrendingUp size={120} />
              </div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Faturamento Acumulado</p>
              <p className="text-4xl font-black text-slate-900 relative z-10">
                R$ {stats.totalValor.toFixed(2).replace('.', ',')}
              </p>
            </div>
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-indigo-50 opacity-50">
                <Calendar size={120} />
              </div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Média Mensal</p>
              <p className="text-4xl font-black text-slate-900 relative z-10">
                R$ {stats.mediaMensal.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <TrendingUp className="text-indigo-500" />
              Evolução do Faturamento (Mensal)
            </h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(val) => `R$${val}`} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value) => [`R$ ${Number(value ?? 0).toFixed(2)}`, 'Faturamento']}
                    cursor={{ fill: '#f8fafc' }}
                  />
                  <Bar dataKey="valor" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
