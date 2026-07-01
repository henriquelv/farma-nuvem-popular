import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, TrendingUp, Clock, Activity } from 'lucide-react';
import { getSupabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { motion } from 'motion/react';

export default function BIVendasHoje() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [topMeds, setTopMeds] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, valor: 0, ticketMedio: 0 });

  useEffect(() => {
    const fetchData = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const { data, error } = await supabase
          .from('vendas')
          .select('*')
          .gte('data_venda', today.toISOString())
          .order('data_venda', { ascending: true });

        if (error) throw error;

        const vendas = data || [];
        
        // Stats
        const total = vendas.length;
        const valor = vendas.reduce((acc, v) => acc + Number(v.valor), 0);
        setStats({
          total,
          valor,
          ticketMedio: total > 0 ? valor / total : 0
        });

        // Hourly Data (8h to 20h)
        const hoursMap = new Map();
        for (let i = 8; i <= 20; i++) {
          hoursMap.set(`${i.toString().padStart(2, '0')}:00`, 0);
        }

        vendas.forEach(v => {
          const date = new Date(v.data_venda);
          const hour = `${date.getHours().toString().padStart(2, '0')}:00`;
          if (hoursMap.has(hour)) {
            hoursMap.set(hour, hoursMap.get(hour) + Number(v.valor));
          }
        });

        setHourlyData(Array.from(hoursMap, ([hora, valor]) => ({ hora, valor })));

        // Top Meds
        const medsMap = new Map();
        vendas.forEach(v => {
          medsMap.set(v.nome_medicamento, (medsMap.get(v.nome_medicamento) || 0) + 1);
        });
        
        const sortedMeds = Array.from(medsMap, ([nome, qtd]) => ({ nome, qtd }))
          .sort((a, b) => b.qtd - a.qtd)
          .slice(0, 5);
          
        setTopMeds(sortedMeds);

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
          <div className="bg-blue-600 text-white p-2 rounded-xl shadow-lg shadow-blue-600/20">
            <ShoppingCart size={28} />
          </div>
          BI: Vendas Hoje
        </h1>
        <p className="text-slate-500 mt-2 text-lg">Análise detalhada do fluxo de dispensações do dia atual.</p>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-blue-50 opacity-50">
                <Activity size={120} />
              </div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Volume de Vendas</p>
              <p className="text-4xl font-black text-slate-900 relative z-10">{stats.total}</p>
            </div>
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-emerald-50 opacity-50">
                <TrendingUp size={120} />
              </div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Faturamento Bruto</p>
              <p className="text-4xl font-black text-slate-900 relative z-10">
                R$ {stats.valor.toFixed(2).replace('.', ',')}
              </p>
            </div>
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 text-indigo-50 opacity-50">
                <ShoppingCart size={120} />
              </div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 relative z-10">Ticket Médio</p>
              <p className="text-4xl font-black text-slate-900 relative z-10">
                R$ {stats.ticketMedio.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                <Clock className="text-blue-500" />
                Faturamento por Hora
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorValor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(val) => `R$${val}`} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      formatter={(value) => [`R$ ${Number(value ?? 0).toFixed(2)}`, 'Faturamento']}
                    />
                    <Area type="monotone" dataKey="valor" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorValor)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-800 mb-6">Top Medicamentos</h2>
              <div className="space-y-4">
                {topMeds.map((med, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </div>
                      <span className="font-semibold text-slate-700">{med.nome}</span>
                    </div>
                    <span className="font-black text-slate-900">{med.qtd}x</span>
                  </div>
                ))}
                {topMeds.length === 0 && (
                  <p className="text-slate-500 text-center py-8">Nenhuma venda registrada hoje.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
