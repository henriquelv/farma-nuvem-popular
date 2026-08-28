import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  LayoutDashboard,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSupabase, explainSupabaseError } from '../lib/supabase';
import { isFutureDate, maskCPF, maskDate, normalizePersonName, parseDateToDB, sanitizePersonNameInput, validateCPF } from '../lib/validators';
import { matchesSearchText } from '../lib/search';
import Dashboard from './Dashboard';
import AccountSettings from './AccountSettings';

type AdminTab = 'painel' | 'pacientes' | 'registros' | 'conta';

const dbDateToBR = (date?: string) => {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
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
  const [tab, setTab] = useState<AdminTab>('painel');
  const [clients, setClients] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [deletingClient, setDeletingClient] = useState<any | null>(null);

  const fetchData = async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    setLoading(true);
    setError('');
    try {
      const [{ data: clientsData, error: clientsError }, { data: salesData, error: salesError }] = await Promise.all([
        supabase.from('clientes').select('id, nome_completo, cpf, data_nascimento, created_at').order('created_at', { ascending: false }),
        supabase
          .from('vendas')
          .select('id, cliente_id, data_venda, created_at, clientes(nome_completo, cpf)')
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
    const term = query.trim();
    const digits = query.replace(/\D/g, '');
    if (!term && !digits) return clients;
    return clients.filter((client) => {
      const cpf = String(client.cpf || '');
      return matchesSearchText(client.nome_completo, term) || (digits && cpf.includes(digits));
    });
  }, [clients, query]);

  const filteredSales = useMemo(() => {
    const term = query.trim();
    const digits = query.replace(/\D/g, '');
    if (!term && !digits) return sales;
    return sales.filter((sale) => {
      const cpf = String(sale.clientes?.cpf || '');
      return matchesSearchText(sale.clientes?.nome_completo, term)
        || (digits && cpf.includes(digits));
    });
  }, [sales, query]);

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-500 mb-2">Controle interno</p>
          <h1 className="text-4xl font-black text-slate-950 tracking-tight">Admin</h1>
          <p className="text-slate-500 mt-2 text-lg">Painel, cadastros e registros administrativos em um só lugar.</p>
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
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl w-full sm:grid-cols-4 lg:w-fit">
            <button
              type="button"
              onClick={() => setTab('painel')}
              className={`px-4 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                tab === 'painel' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LayoutDashboard size={17} />
              Painel
            </button>
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
            <button
              type="button"
              onClick={() => setTab('conta')}
              className={`px-4 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                tab === 'conta' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <UserCog size={17} />
              Minha conta
            </button>
          </div>

          {tab !== 'painel' && tab !== 'conta' && <div className="relative w-full lg:max-w-md">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nome ou CPF..."
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-500 focus:bg-white text-slate-700 font-semibold"
            />
          </div>}
        </div>

        <div className="p-4 sm:p-5">
          {tab === 'painel' ? (
            <Dashboard />
          ) : tab === 'conta' ? (
            <AccountSettings />
          ) : loading ? (
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
                        onClick={() => setDeletingClient(client)}
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
                  </div>
                  <div className="flex gap-2">
                    <span className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 font-black text-sm inline-flex items-center gap-2">
                      <ShieldCheck size={15} />
                      Histórico preservado
                    </span>
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
        {deletingClient && (
          <DeleteClientModal
            client={deletingClient}
            onClose={() => setDeletingClient(null)}
            onDeleted={async () => {
              setDeletingClient(null);
              await fetchData();
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DeleteClientModal({ client, onClose, onDeleted }: { client: any; onClose: () => void; onDeleted: () => void }) {
  const [checking, setChecking] = useState(true);
  const [salesCount, setSalesCount] = useState(0);
  const [documentsCount, setDocumentsCount] = useState(0);
  const [typedName, setTypedName] = useState('');
  const [cpfSuffix, setCpfSuffix] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkHistory = async () => {
      const supabase = getSupabase();
      if (!supabase) return;
      setChecking(true);
      setError('');
      try {
        const [salesResult, documentsResult] = await Promise.all([
          supabase.from('vendas').select('id', { count: 'exact', head: true }).eq('cliente_id', client.id),
          supabase.from('vendas_documentos').select('id', { count: 'exact', head: true }).eq('cliente_id', client.id),
        ]);
        if (salesResult.error) throw salesResult.error;
        if (documentsResult.error) throw documentsResult.error;
        setSalesCount(salesResult.count || 0);
        setDocumentsCount(documentsResult.count || 0);
      } catch (err: any) {
        setError(explainSupabaseError(err));
      } finally {
        setChecking(false);
      }
    };
    void checkHistory();
  }, [client.id]);

  const cleanCpf = String(client.cpf || '').replace(/\D/g, '');
  const expectedSuffix = cleanCpf.slice(-4);
  const hasHistory = salesCount > 0 || documentsCount > 0;
  const nameMatches = normalizePersonName(typedName) === normalizePersonName(client.nome_completo);
  const cpfMatches = cpfSuffix === expectedSuffix;
  const canDelete = !checking && !hasHistory && !error && nameMatches && cpfMatches && acknowledged && !deleting;

  const handleDelete = async () => {
    if (!canDelete) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setDeleting(true);
    setError('');
    try {
      const { error: deleteError } = await supabase.from('clientes').delete().eq('id', client.id);
      if (deleteError) throw deleteError;
      onDeleted();
    } catch (err: any) {
      setError(explainSupabaseError(err));
      setDeleting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm p-4 flex items-center justify-center">
      <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl border border-slate-200">
        <div className="flex items-start gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
            <LockKeyhole size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-600">Área protegida</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">Excluir paciente</h2>
            <p className="mt-1 truncate text-sm font-semibold text-slate-500">{client.nome_completo}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700" title="Fechar" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {checking ? (
            <div className="flex items-center gap-3 py-8 justify-center text-sm font-bold text-slate-500">
              <RefreshCw size={18} className="animate-spin" /> Verificando histórico fiscal...
            </div>
          ) : hasHistory ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-red-800">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-black">Exclusão bloqueada</p>
                  <p className="mt-1 text-sm font-semibold leading-relaxed">Este paciente possui {salesCount} registro(s) de compra e {documentsCount} arquivo(s). O histórico deve permanecer disponível para auditoria fiscal.</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-900">
                Este cadastro não possui histórico vinculado. A exclusão é permanente e não pode ser desfeita.
              </div>
              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">Digite o nome completo</label>
                <input value={typedName} onChange={(event) => setTypedName(sanitizePersonNameInput(event.target.value))} autoComplete="off" spellCheck={false} placeholder={client.nome_completo} className="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3 font-bold text-slate-900 outline-none focus:border-red-400" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">Últimos 4 dígitos do CPF</label>
                <input value={cpfSuffix} onChange={(event) => setCpfSuffix(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="0000" className="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3 font-bold tracking-[0.25em] text-slate-900 outline-none focus:border-red-400" />
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-red-600" />
                <span className="text-sm font-semibold leading-relaxed text-slate-600">Confirmo que revisei o cadastro e desejo removê-lo permanentemente.</span>
              </label>
            </>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        </div>

        <div className="flex gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 font-black text-slate-700 hover:bg-slate-100">Cancelar</button>
          {!hasHistory && !checking && (
            <button type="button" onClick={handleDelete} disabled={!canDelete} className="flex-1 rounded-lg bg-red-700 px-4 py-3 font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-35">
              {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </button>
          )}
        </div>
      </motion.div>
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
    const normalizedName = normalizePersonName(nome);
    if (normalizedName.length < 3) {
      setError('Informe o nome completo do paciente.');
      return;
    }
    if (!validateCPF(cpf)) {
      setError('CPF inválido. Confira os 11 dígitos informados.');
      return;
    }
    if (!dbDate) {
      setError('Data de nascimento inválida. Use DD/MM/AAAA.');
      return;
    }
    if (isFutureDate(dbDate)) {
      setError('A data de nascimento não pode estar no futuro.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('clientes')
        .update({
          nome_completo: normalizedName,
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
            <input value={nome} onChange={(event) => setNome(sanitizePersonNameInput(event.target.value))} onBlur={() => setNome(normalizePersonName(nome))} autoComplete="off" autoCorrect="off" spellCheck={false} translate="no" className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-700">CPF</label>
              <input value={cpf} inputMode="numeric" autoComplete="off" maxLength={14} onChange={(event) => setCpf(maskCPF(event.target.value))} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold tracking-widest" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-700">Data de nascimento</label>
              <input value={nascimento} inputMode="numeric" autoComplete="off" maxLength={10} onChange={(event) => setNascimento(maskDate(event.target.value))} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-semibold" />
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
