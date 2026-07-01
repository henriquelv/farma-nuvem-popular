import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabase } from '../lib/supabase';
import { ShoppingCart, FileText, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    vendasHoje: 0,
    cuponsHoje: 0,
    totalVendas: 0,
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        setLoading(true);
        
        // Data de hoje para filtros
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString();

        // Buscar vendas de hoje
        const { data: vendasHojeData, error: errVendas } = await supabase
          .from('vendas')
          .select('id')
          .gte('data_venda', todayStr);

        if (errVendas) throw errVendas;

        const vendaIdsHoje = (vendasHojeData || []).map(v => v.id);
        let cuponsCount = 0;
        if (vendaIdsHoje.length) {
          const { count: cuponsHojeCount, error: errCupons } = await supabase
            .from('vendas_documentos')
            .select('*', { count: 'exact', head: true })
            .eq('tipo', 'cupom')
            .in('venda_id', vendaIdsHoje);
          if (errCupons) throw errCupons;
          cuponsCount = cuponsHojeCount || 0;
        }

        // Buscar total geral (simplificado para o MVP)
        const { count: totalVendasCount, error: errTotal } = await supabase
          .from('vendas')
          .select('*', { count: 'exact', head: true });

        if (errTotal) throw errTotal;

        setStats({
          vendasHoje: vendasHojeData?.length || 0,
          cuponsHoje: cuponsCount,
          totalVendas: totalVendasCount || 0,
        });

        // Gerar dados do gráfico (últimos 7 dias)
        const last7Days = Array.from({ length: 7 }).map((_, i) => {
          const d = subDays(new Date(), 6 - i);
          return {
            date: d,
            dateStr: format(d, 'yyyy-MM-dd'),
            display: format(d, 'dd/MM', { locale: ptBR }),
            vendas: 0
          };
        });

        const sevenDaysAgo = subDays(new Date(), 7).toISOString();
        
        const { data: vendasSemana, error: errSemana } = await supabase
          .from('vendas')
          .select('data_venda')
          .gte('data_venda', sevenDaysAgo);

        if (errSemana) throw errSemana;

        if (vendasSemana) {
          vendasSemana.forEach(venda => {
            const vendaDate = new Date(venda.data_venda);
            const dateStr = format(vendaDate, 'yyyy-MM-dd');
            const dayData = last7Days.find(d => d.dateStr === dateStr);
            if (dayData) {
              dayData.vendas += 1;
            }
          });
        }

        setChartData(last7Days);
      } catch (err: any) {
        console.error('Erro ao buscar dados do dashboard:', err);
        setError('Não foi possível carregar os dados. Verifique sua conexão com o Supabase.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-7xl mx-auto"
    >
      <div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-slate-500 mt-2 text-lg">Visão geral das operações da Farmácia Popular.</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 border border-red-100">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          whileHover={{ scale: 1.02, y: -4 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/bi/vendas-hoje')}
          className="bg-white p-6 rounded-3xl shadow-sm hover:shadow-xl hover:shadow-blue-500/10 border border-slate-100 flex flex-col justify-between cursor-pointer transition-all group relative overflow-hidden"
        >
          <div className="absolute -right-6 -top-6 text-blue-50 opacity-50 transition-transform group-hover:scale-110 group-hover:rotate-12">
            <ShoppingCart size={120} />
          </div>
          <div className="flex items-center justify-between relative z-10 mb-4">
            <div className="bg-blue-500 text-white p-4 rounded-2xl shadow-lg shadow-blue-500/30">
              <ShoppingCart size={28} />
            </div>
            <ArrowRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
          </div>
          <div className="relative z-10">
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Vendas Hoje</p>
            <p className="text-4xl font-black text-slate-900 mt-1">{stats.vendasHoje}</p>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ scale: 1.02, y: -4 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/bi/cupons')}
          className="bg-white p-6 rounded-3xl shadow-sm hover:shadow-xl hover:shadow-emerald-500/10 border border-slate-100 flex flex-col justify-between cursor-pointer transition-all group relative overflow-hidden"
        >
          <div className="absolute -right-6 -top-6 text-emerald-50 opacity-50 transition-transform group-hover:scale-110 group-hover:rotate-12">
            <FileText size={120} />
          </div>
          <div className="flex items-center justify-between relative z-10 mb-4">
            <div className="bg-emerald-500 text-white p-4 rounded-2xl shadow-lg shadow-emerald-500/30">
              <FileText size={28} />
            </div>
            <ArrowRight className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
          </div>
          <div className="relative z-10">
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Cupons Anexados</p>
            <p className="text-4xl font-black text-slate-900 mt-1">{stats.cuponsHoje}</p>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ scale: 1.02, y: -4 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/bi/historico')}
          className="bg-white p-6 rounded-3xl shadow-sm hover:shadow-xl hover:shadow-indigo-500/10 border border-slate-100 flex flex-col justify-between cursor-pointer transition-all group relative overflow-hidden"
        >
          <div className="absolute -right-6 -top-6 text-indigo-50 opacity-50 transition-transform group-hover:scale-110 group-hover:rotate-12">
            <TrendingUp size={120} />
          </div>
          <div className="flex items-center justify-between relative z-10 mb-4">
            <div className="bg-indigo-500 text-white p-4 rounded-2xl shadow-lg shadow-indigo-500/30">
              <TrendingUp size={28} />
            </div>
            <ArrowRight className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
          </div>
          <div className="relative z-10">
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Histórico</p>
            <p className="text-4xl font-black text-slate-900 mt-1">{stats.totalVendas}</p>
          </div>
        </motion.div>
      </div>

      {/* Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100"
      >
        <h2 className="text-xl font-bold text-slate-800 mb-8 flex items-center gap-2">
          <TrendingUp className="text-blue-500" />
          Vendas nos Últimos 7 Dias
        </h2>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="display" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} 
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }}
              />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="vendas" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={60} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </motion.div>
  );
}
