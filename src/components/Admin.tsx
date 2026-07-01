import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSupabase, explainSupabaseError } from '../lib/supabase';
import { maskCPF, maskDate, parseDateToDB } from '../lib/validators';

type AdminTab = 'pacientes' | 'registros';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dbDateToBR = (date?: string) => {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
};

const toDateTimeLocal = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

const fromDateTimeLocal = (value: string) => {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
};

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200">
      <ShieldCheck size={42} className="mx-auto text-slate-300 mb-3" />
      <p className="font-black text-slate-700">{label}</p>
    </div>
  );
}

function AdminModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="w-full max-w-xl max-h-[calc(100dvh-1.5rem)] bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col"
      >
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] font-black text-blue-500">Admin</p>
            <h2 className="text-2xl font-black text-slate-900 leading-tight">{title}</h2>
            <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X size={22} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState<AdminTab>('pacientes');
  const [clients, setClients] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [editingSale, setEditingSale] = useState<any | null>(null);

  const fetchData = async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    setLoading(true);
    setError('');
    try {
      const [{ data: clientsData, error: clientsError }, { data: salesData, error: salesError }] = await Promise.all([
        supabase.from('clientes').select('*').order('created_at', { ascending: false }),
        supabase
          .from('vendas')
          .select('id, cliente_id, data_venda, nome_medicamento, valor, created_at, clientes(nome_completo, cpf)')
          .order('data_venda', { ascending: false }),
      ]);

      if (clientsError) throw clientsError;
      if (salesError) throw salesError;

      setClients(clientsData || []);
      setSales(salesData || []);
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredClients = useMemo(() => {
    const term = query.trim().toLowerCase();
    const digits = query.replace(/\D/g, '');
    if (!term && !digits) return clients;
    return clients.filter((client) => {
      const name = String(client.nome_completo || '').toLowerCase();
      const cpf = String(client.cpf || '');
      return name.includes(term) || (digits && cpf.includes(digits));
    });
  }, [clients, query]);

  const filteredSales = useMemo(() => {
    const term = query.trim().toLowerCase();
    const digits = query.replace(/\D/g, '');
    if (!term && !digits) return sales;
    return sales.filter((sale) => {
      const name = String(sale.clientes?.nome_completo || '').toLowerCase();
      const cpf = String(sale.clientes?.cpf || '');
      const med = String(sale.nome_medicamento || '').toLowerCase();
      return name.includes(term) || med.includes(term) || (digits && cpf.includes(digits));
    });
  }, [sales, query]);

  const handleDeleteClient = async (client: any) => {
    if (!window.confirm(`Excluir ${client.nome_completo}? Isso também remove os registros vinculados.`)) return;
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: deleteError } = await supabase.from('clientes').delete().eq('id', client.id);
      if (deleteError) throw deleteError;
      await fetchData();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    }
  };

  const handleDeleteSale = async (sale: any) => {
    const clientName = sale.clientes?.nome_completo || 'este registro';
    if (!window.confirm(`Excluir registro de ${clientName}? Os documentos vinculados serão removidos da lista.`)) return;
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: deleteError } = await supabase.from('vendas').delete().eq('id', sale.id);
      if (deleteError) throw deleteError;
      await fetchData();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-500 mb-2">Controle interno</p>
          <h1 className="text-4xl font-black text-slate-950 tracking-tight">Admin</h1>
          <p className="text-slate-500 mt-2 text-lg">Edite cadastros, revise registros e remova itens incorretos.</p>
        </div>
        <button
          type="button"
          onClick={fetchData}
          className="w-fit inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
        >
          <RefreshCw size={18} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl flex items-center gap-3 border border-red-100 font-semibold">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl w-full lg:w-fit">
            <button
              type="button"
              onClick={() => setTab('pacientes')}
              className={`px-4 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                tab === 'pacientes' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Users size={17} />
              Pacientes
            </button>
            <button
              type="button"
              onClick={() => setTab('registros')}
              className={`px-4 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                tab === 'registros' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <ShoppingCart size={17} />
              Registros
            </button>
          </div>

          <div className="relative w-full lg:max-w-md">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'pacientes' ? 'Buscar nome ou CPF...' : 'Buscar cliente, CPF ou medicamento...'}
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 focus:bg-white text-slate-700 font-semibold"
            />
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tab === 'pacientes' ? (
            filteredClients.length ? (
              <div className="space-y-2">
                {filteredClients.map((client) => (
                  <div key={client.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/70 hover:bg-white hover:border-blue-100 transition-all flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-900 truncate">{client.nome_completo}</p>
                      <p className="text-sm text-slate-500 font-semibold mt-1">
                        CPF {String(client.cpf || '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')} · Nasc. {new Date(`${client.data_nascimento}T12:00:00`).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingClient(client)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 font-black text-sm hover:text-blue-700 hover:border-blue-200 inline-flex items-center gap-2"
                      >
                        <Pencil size={15} />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteClient(client)}
                        className="px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 font-black text-sm hover:bg-red-100 inline-flex items-center gap-2"
                      >
                        <Trash2 size={15} />
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label="Nenhum paciente encontrado" />
            )
          ) : filteredSales.length ? (
            <div className="space-y-2">
              {filteredSales.map((sale) => (
                <div key={sale.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/70 hover:bg-white hover:border-blue-100 transition-all flex flex-col xl:flex-row xl:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-slate-900 truncate">{sale.clientes?.nome_completo || 'Paciente não encontrado'}</p>
                      <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {new Date(sale.data_venda || sale.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 font-semibold mt-1">
                      {sale.nome_medicamento || 'Medicamento não informado'} · {currency.format(Number(sale.valor || 0))}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingSale(sale)}
                      className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 font-black text-sm hover:text-blue-700 hover:border-blue-200 inline-flex items-center gap-2"
                    >
                      <Pencil size={15} />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSale(sale)}
                      className="px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 font-black text-sm hover:bg-red-100 inline-flex items-center gap-2"
                    >
                      <Trash2 size={15} />
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="Nenhum registro encontrado" />
          )}
        </div>
      </div>

      <AnimatePresence>
        {editingClient && (
          <EditClientModal
            client={editingClient}
            onClose={() => setEditingClient(null)}
            onSaved={async () => {
              setEditingClient(null);
              await fetchData();
            }}
          />
        )}
        {editingSale && (
          <EditSaleModal
            sale={editingSale}
            onClose={() => setEditingSale(null)}
            onSaved={async () => {
              setEditingSale(null);
              await fetchData();
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EditClientModal({ client, onClose, onSaved }: { client: any; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState(client.nome_completo || '');
  const [cpf, setCpf] = useState(maskCPF(client.cpf || ''));
  const [nascimento, setNascimento] = useState(dbDateToBR(client.data_nascimento));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabase();
    const dbDate = parseDateToDB(nascimento);
    if (!supabase) return;
    if (!dbDate) {
      setError('Data de nascimento inválida. Use DD/MM/AAAA.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('clientes')
        .update({
          nome_completo: nome.trim(),
          cpf: cpf.replace(/\D/g, ''),
          data_nascimento: dbDate,
        })
        .eq('id', client.id);

      if (updateError) throw updateError;
      onSaved();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal title="Editar paciente" subtitle="Atualize os dados principais do cadastro." onClose={onClose}>
      <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl font-semibold border border-red-100">{error}</div>}
          <div className="space-y-2">
            <label className="text-sm font-black text-slate-700">Nome completo</label>
            <input value={nome} onChange={(event) => setNome(event.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-700">CPF</label>
              <input value={cpf} maxLength={14} onChange={(event) => setCpf(maskCPF(event.target.value))} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold tracking-widest" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-700">Data de nascimento</label>
              <input value={nascimento} maxLength={10} onChange={(event) => setNascimento(maskDate(event.target.value))} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 bg-white border-2 border-slate-200 rounded-2xl text-slate-500 font-black">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-black disabled:opacity-60 inline-flex items-center justify-center gap-2">
            <Save size={18} />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}

function EditSaleModal({ sale, onClose, onSaved }: { sale: any; onClose: () => void; onSaved: () => void }) {
  const [medicamento, setMedicamento] = useState(sale.nome_medicamento || '');
  const [valor, setValor] = useState(String(sale.valor ?? 0));
  const [dataVenda, setDataVenda] = useState(toDateTimeLocal(sale.data_venda || sale.created_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;

    const numericValue = Number(String(valor).replace(',', '.')) || 0;
    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('vendas')
        .update({
          data_venda: fromDateTimeLocal(dataVenda),
          nome_medicamento: medicamento.trim() || 'Não informado',
          valor: numericValue,
        })
        .eq('id', sale.id);

      if (updateError) throw updateError;
      onSaved();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal title="Editar registro" subtitle={sale.clientes?.nome_completo || 'Registro de venda'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl font-semibold border border-red-100">{error}</div>}
          <div className="space-y-2">
            <label className="text-sm font-black text-slate-700">Medicamento</label>
            <input value={medicamento} onChange={(event) => setMedicamento(event.target.value)} placeholder="Ex: Losartana" className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-700">Valor</label>
              <input value={valor} inputMode="decimal" onChange={(event) => setValor(event.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-700">Data e hora</label>
              <input type="datetime-local" value={dataVenda} onChange={(event) => setDataVenda(event.target.value)} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
            </div>
          </div>
          <div className="flex items-start gap-3 bg-amber-50 text-amber-800 border border-amber-100 rounded-2xl px-4 py-3 text-sm font-semibold">
            <CalendarClock size={18} className="flex-shrink-0 mt-0.5" />
            Os anexos continuam vinculados ao registro após salvar.
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 bg-white border-2 border-slate-200 rounded-2xl text-slate-500 font-black">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-black disabled:opacity-60 inline-flex items-center justify-center gap-2">
            <Save size={18} />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
