import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, FileText, Search, Plus, User, X, Filter, ZoomIn, ZoomOut, Printer, Maximize2, UploadCloud, ChevronRight, LoaderCircle } from 'lucide-react';
import { getSupabase, explainSupabaseError } from '../lib/supabase';
import { isFutureDate, maskCPF, maskDate, normalizePersonName, parseDateToDB, sanitizePersonNameInput, validateCPF } from '../lib/validators';
import { buildPrescriptionMeta, formatDateBR, getPrescriptionEndDate, isPdfDocument } from '../lib/documents';
import { prepareDocumentForUpload, checkFileFeasibility } from '../lib/media-compression';
import { searchMatchScore } from '../lib/search';
import { buildDocumentPath, documentBucket } from '../lib/storage';
import { useAuth } from '../auth/AuthContext';
import { motion, AnimatePresence } from 'motion/react';

// --- VISUALIZADOR REUTILIZÁVEL (MESMO DO PROFILE) ---
function FullscreenViewer({ url, title, onClose }: any) {
  const [zoom, setZoom] = useState(1);
  const [imgError, setImgError] = useState(false);
  const isPdf = isPdfDocument(url, title);
  const showAsPdf = isPdf || imgError;
  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (win) {
      const tag = showAsPdf ? 'iframe' : 'img';
      win.document.write(`<html lang="pt-BR" translate="no"><body class="notranslate" translate="no" style="margin:0;display:flex;justify-content:center;align-items:center;background:#fff;"><${tag} src="${url}" style="width:100%;height:100%;border:0;object-fit:contain;"></${tag}></body></html>`);
      win.document.close(); win.focus();
      setTimeout(() => { win.print(); win.close(); }, 500);
    }
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/95 z-[100] flex flex-col pt-16">
      <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-10 bg-black/40 backdrop-blur-md border-b border-white/5">
        <h3 className="text-white font-black uppercase text-xs tracking-widest px-4">{title}</h3>
        <div className="flex items-center gap-2 pr-4">
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="p-2 text-white/70 hover:text-white"><ZoomOut size={20}/></button>
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="p-2 text-white/70 hover:text-white"><ZoomIn size={20}/></button>
          <button onClick={handlePrint} className="p-2 text-white/70 hover:text-white ml-4"><Printer size={20}/></button>
          <button onClick={onClose} className="p-2 bg-red-500 text-white rounded-full ml-4"><X size={18}/></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8 bg-slate-100">
        {showAsPdf ? (
          <iframe src={url} title={title} className="w-full h-full bg-white rounded-xl shadow-2xl border border-slate-200" />
        ) : (
          <motion.img src={url} onError={() => setImgError(true)} style={{ scale: zoom }} className="max-h-full max-w-full shadow-2xl transition-transform duration-200 bg-white rounded-xl" />
        )}
      </div>
    </motion.div>
  );
}

export default function ClientManagement() {
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  // Advanced Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [periodTarget, setPeriodTarget] = useState<'compras' | 'documentos'>('compras');
  const [filterTipoDoc, setFilterTipoDoc] = useState<'todos' | 'receita' | 'cupom' | 'documento' | 'procuracao'>('todos');
  
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalDoc, setModalDoc] = useState<{ url: string; title: string } | null>(null);
  const navigate = useNavigate();
  const searchSequence = useRef(0);

  const handleSearch = async (e?: React.FormEvent, live = false) => {
    if (e) e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;

    const sequence = ++searchSequence.current;
    if (live) setSearching(true);
    else setLoading(true);
    setSearchError('');
    try {
      const startDb = startDate ? parseDateToDB(startDate) : null;
      const endDb = endDate ? parseDateToDB(endDate) : null;
      if (startDate && !startDb) throw new Error('Data inicial inválida. Use DD/MM/AAAA.');
      if (endDate && !endDb) throw new Error('Data final inválida. Use DD/MM/AAAA.');
      if (startDb && endDb && startDb > endDb) throw new Error('A data inicial não pode ser posterior à data final.');

      let query = supabase.from('clientes').select('*').order('created_at', { ascending: false });

      const hasAdvancedFilters = startDate || endDate || filterTipoDoc !== 'todos' || periodTarget === 'documentos';

      if (hasAdvancedFilters) {
        if (periodTarget === 'documentos' || filterTipoDoc !== 'todos') {
          let docsQuery = supabase.from('vendas_documentos').select('cliente_id');
          if (filterTipoDoc !== 'todos') docsQuery = docsQuery.eq('tipo', filterTipoDoc);

          if (startDate.length === 10) {
            if (startDb) {
              const start = new Date(startDb); start.setHours(0, 0, 0, 0);
              docsQuery = docsQuery.gte('created_at', start.toISOString());
            }
          }
          if (endDate.length === 10) {
            if (endDb) {
              const end = new Date(endDb); end.setHours(23, 59, 59, 999);
              docsQuery = docsQuery.lte('created_at', end.toISOString());
            }
          }

          const { data: docsData, error: docsError } = await docsQuery;
          if (docsError) throw docsError;
          const clientIds = [...new Set(docsData.map((d: any) => d.cliente_id))];
          if (clientIds.length > 0) {
            query = query.in('id', clientIds);
          } else {
            if (sequence === searchSequence.current) setData([]);
            return;
          }
        } else {
          let vendasQuery = supabase.from('vendas').select('cliente_id');

          if (startDb) {
              const start = new Date(startDb); start.setHours(0, 0, 0, 0);
            vendasQuery = vendasQuery.gte('data_venda', start.toISOString());
          }
          if (endDb) {
              const end = new Date(endDb); end.setHours(23, 59, 59, 999);
            vendasQuery = vendasQuery.lte('data_venda', end.toISOString());
          }
          const { data: vendasData, error: vendasError } = await vendasQuery;
          if (vendasError) throw vendasError;
          const clientIds = [...new Set(vendasData.map(v => v.cliente_id))];
          if (clientIds.length > 0) {
            query = query.in('id', clientIds);
          } else {
            if (sequence === searchSequence.current) setData([]);
            return;
          }
        }
      }

      const { data: clientsData, error } = await query.limit(1000);
      if (error) throw error;
      const cleanCpf = searchTerm.replace(/\D/g, '');
      const filtered = searchTerm.trim()
        ? (clientsData || []).map((client: any) => {
          const cpfMatch = cleanCpf.length > 0 && String(client.cpf || '').includes(cleanCpf);
          return { client, score: cpfMatch ? 0 : searchMatchScore(client.nome_completo, searchTerm) };
        }).filter(({ score }: any) => Number.isFinite(score))
        : (clientsData || []).map((client: any) => ({ client, score: 0 }));
      const directMatches = filtered.filter(({ score }: any) => score <= 2);
      const relevantMatches = directMatches.length > 0 ? directMatches : filtered;
      relevantMatches.sort((left: any, right: any) => left.score - right.score);
      const resultLimit = directMatches.length > 0 ? 50 : 10;
      if (sequence === searchSequence.current) {
        setData(relevantMatches.slice(0, resultLimit).map(({ client }: any) => client));
      }
    } catch (err: any) {
      if (sequence === searchSequence.current) setSearchError(explainSupabaseError(err));
    } finally {
      if (sequence === searchSequence.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  };

  const handleClearFilters = async () => {
    setStartDate('');
    setEndDate('');
    setSearchTerm('');
    setPeriodTarget('compras');
    setFilterTipoDoc('todos');
    setShowFilters(false);
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    setSearchError('');
    try {
      const { data: clientsData, error } = await supabase.from('clientes')
        .select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      setData(clientsData || []);
    } catch (err: any) {
      setSearchError(explainSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void handleSearch(undefined, searchTerm.trim().length > 0);
    }, searchTerm.trim().length > 0 ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-7xl mx-auto"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Pacientes</h1>
          <p className="text-slate-400 mt-1">Clique em um paciente para ver os registros e documentos.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-lg shadow-blue-600/30"
        >
          <Plus size={20} />
          <span>Cadastrar Paciente</span>
        </button>
      </div>

      <div className="bg-white p-5 sm:p-6 rounded-lg shadow-sm border border-slate-200">
        <form onSubmit={handleSearch} className="flex flex-col gap-4 mb-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <Search size={20} />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Buscar por Nome ou CPF..."
                className="w-full pl-11 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-slate-700 font-medium"
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                {searching ? (
                  <LoaderCircle size={18} className="animate-spin text-blue-500" aria-label="Buscando" />
                ) : searchTerm ? (
                  <button type="button" onClick={() => setSearchTerm('')} className="p-1 text-slate-400 hover:text-slate-700" title="Limpar busca" aria-label="Limpar busca">
                    <X size={17} />
                  </button>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`px-5 py-3 rounded-xl font-bold transition-all flex items-center gap-2 border ${
                showFilters
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Filter size={20} />
              <span className="hidden sm:inline">Filtros Avançados</span>
            </button>
            <button
              type="submit"
              className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-slate-900/20"
            >
              Buscar
            </button>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-5 bg-slate-50 rounded-lg border border-slate-200 mt-4 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">Buscar período em</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { v: 'compras', label: 'Compras' },
                          { v: 'documentos', label: 'Docs' },
                        ] as const).map(({ v, label }) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setPeriodTarget(v)}
                            className={`px-3 py-3 rounded-lg border font-black text-xs transition-colors ${
                              periodTarget === v ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">Período</label>
                      <div className="flex gap-2">
                        <input type="text" value={startDate} onChange={(e) => setStartDate(maskDate(e.target.value))} placeholder="Início" maxLength={10} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold" />
                        <input type="text" value={endDate} onChange={(e) => setEndDate(maskDate(e.target.value))} placeholder="Fim" maxLength={10} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold" />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">Tipo de documento</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { v: 'todos', label: 'Todos' },
                          { v: 'receita', label: 'Receitas' },
                          { v: 'cupom', label: 'Cupons' },
                          { v: 'documento', label: 'Documento' },
                          { v: 'procuracao', label: 'Procuração' },
                        ] as const).map(({ v, label }) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setFilterTipoDoc(v)}
                            className={`px-3 py-2.5 rounded-lg border transition-colors font-black text-[10px] uppercase tracking-widest ${
                              filterTipoDoc === v ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-200/50">
                    <button type="button" onClick={handleClearFilters} className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest hover:text-slate-600 transition-colors">Limpar Tudo</button>
                    <button type="submit" className="px-8 py-3 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10">Aplicar Filtros</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>

        {searchError && (
          <div className="mb-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {searchError}
          </div>
        )}

        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          </div>
        ) : data.length > 0 ? (
          <div className="space-y-2" aria-live="polite">
            {data.map((client, i) => (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.15) }}
                onClick={() => navigate(`/clientes/${client.id}`)}
                className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50 cursor-pointer transition-all group"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <User size={20} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-base">{client.nome_completo}</p>
                  <p className="text-sm text-slate-400 font-medium">
                    CPF: {client.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}
                    {' · '}
                    Nasc: {new Date(client.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="py-20 text-center text-slate-500 bg-slate-50 rounded-2xl border border-slate-100 border-dashed"
          >
            <Search size={48} className="mx-auto mb-4 text-slate-300" />
            <p className="text-xl font-bold text-slate-700">Nenhum registro encontrado</p>
            <p className="text-base mt-2">Tente buscar com outros termos ou altere os filtros.</p>
          </motion.div>
        )}
      </div>

      {showModal && (
        <NewClientModal farmaciaId={profile!.farmacia_id} onClose={() => setShowModal(false)} onClientAdded={handleSearch} />
      )}
      
      {modalDoc && <FullscreenViewer url={modalDoc.url} title={modalDoc.title} onClose={() => setModalDoc(null)} />}
    </motion.div>
  );
}

function NewClientModal({ farmaciaId, onClose, onClientAdded }: { farmaciaId: string; onClose: () => void; onClientAdded: () => void }) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [documentoReceita, setDocumentoReceita] = useState<File | null>(null);
  const [receitaInicio, setReceitaInicio] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const dbDate = parseDateToDB(nascimento);
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
      setError('Data de nascimento inválida. Digite no formato DD/MM/AAAA.');
      return;
    }
    if (isFutureDate(dbDate)) {
      setError('A data de nascimento não pode estar no futuro.');
      return;
    }
    const receitaInicioDb = parseDateToDB(receitaInicio);
    if (!documentoReceita) {
      setError('Anexe o arquivo escaneado com RG/CPF e receita.');
      return;
    }
    if (!receitaInicioDb) {
      setError('Informe a data de início da receita no formato DD/MM/AAAA.');
      return;
    }
    if (isFutureDate(receitaInicioDb)) {
      setError('A data de início da receita não pode estar no futuro.');
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setError('Credenciais do Supabase não configuradas.');
      return;
    }
    const cleanCpf = cpf.replace(/\D/g, '');
    const { data: existingClient, error: duplicateCheckError } = await supabase
      .from('clientes')
      .select('id, nome_completo')
      .eq('cpf', cleanCpf)
      .maybeSingle();
    if (duplicateCheckError) {
      setError(explainSupabaseError(duplicateCheckError));
      return;
    }
    if (existingClient) {
      setError(`Este CPF já está cadastrado para ${existingClient.nome_completo}.`);
      return;
    }

    setLoading(true);
    setStatusMsg('');

    const feasibilityErr = await checkFileFeasibility(documentoReceita);
    if (feasibilityErr) { setError(feasibilityErr); setLoading(false); return; }

    let createdClientId: string | null = null;
    try {
      let url_identidade_frontal: string | null = null;

      const prepared = await prepareDocumentForUpload(documentoReceita, (status) => {
        setStatusMsg(status === 'optimizing' ? 'Otimizando arquivo...' : status === 'uploading' ? 'Enviando documento...' : 'Preparando documento...');
      });
      const fileToUpload = prepared.file;
      const ext = fileToUpload.name.split('.').pop();
      const path = buildDocumentPath(farmaciaId, 'cadastros', `cadastro_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
      const { error: upErr } = await supabase.storage.from(documentBucket).upload(path, fileToUpload, {
        contentType: fileToUpload.type,
      });
      if (upErr) throw upErr;
      url_identidade_frontal = path;

      const { data: newClient, error: insertError } = await supabase.from('clientes').insert([{
        farmacia_id: farmaciaId,
        nome_completo: normalizedName,
        cpf: cleanCpf,
        data_nascimento: dbDate,
        url_identidade_frontal,
      }]).select('id').single();

      if (insertError) throw insertError;
      createdClientId = newClient.id;

      const { error: receitaError } = await supabase.from('vendas_documentos').insert([{
        farmacia_id: farmaciaId,
        venda_id: null,
        cliente_id: newClient.id,
        tipo: 'receita',
        url: path,
        nome_arquivo: buildPrescriptionMeta(documentoReceita.name, receitaInicioDb),
      }]);
      if (receitaError) throw receitaError;

      onClientAdded();
      onClose();
    } catch (err: any) {
      if (createdClientId) {
        const { error: rollbackError } = await supabase.rpc('rollback_empty_recent_client', { target_id: createdClientId });
        if (rollbackError) console.error('Falha ao remover cadastro incompleto:', rollbackError);
      }
      setError(explainSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] border border-slate-100 flex flex-col overflow-hidden"
      >
        {/* Cabeçalho */}
        <div className="px-6 py-5 sm:px-7 flex justify-between items-start gap-4 border-b border-slate-100 bg-white">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.22em] mb-1">Novo paciente</p>
            <h2 className="text-2xl font-black text-slate-900 leading-tight">Cadastrar Cliente</h2>
            <p className="text-slate-400 text-sm mt-1">Cadastro, scan único e validade da receita.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors p-2 rounded-xl flex-shrink-0">
            <X size={22} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 space-y-4">
            {statusMsg && (
              <div className="bg-blue-50 text-blue-700 px-4 py-3 rounded-2xl text-sm font-semibold border border-blue-100 flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                {statusMsg}
              </div>
            )}
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl text-sm font-semibold border border-red-100">
                ⚠️ {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-black text-slate-700">Nome completo</label>
              <input
                required
                type="text"
                value={nome}
                onChange={e => setNome(sanitizePersonNameInput(e.target.value))}
                onBlur={() => setNome(normalizePersonName(nome))}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                translate="no"
                placeholder="Ex: Maria da Silva"
                className="w-full px-4 py-3 text-base bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all text-slate-800 font-medium"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-black text-slate-700">CPF</label>
                <input
                  required
                  type="text"
                  value={cpf}
                  onChange={e => setCpf(maskCPF(e.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  placeholder="000.000.000-00"
                  className="w-full px-4 py-3 text-base bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all text-slate-800 font-medium tracking-widest"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-black text-slate-700">Data de nascimento</label>
                <input
                  required
                  type="text"
                  value={nascimento}
                  onChange={e => setNascimento(maskDate(e.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={10}
                  placeholder="DD/MM/AAAA"
                  className="w-full px-4 py-3 text-base bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all text-slate-800 font-medium"
                />
              </div>
            </div>

            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
                  <FileText size={20} />
                </div>
                <div>
                  <p className="text-sm font-black text-blue-950">Arquivo escaneado do cadastro</p>
                  <p className="text-xs font-semibold text-blue-700/70">Use o scan único com RG/CPF e a receita médica.</p>
                </div>
              </div>

              <div className={`relative rounded-2xl border-2 border-dashed transition-all overflow-hidden ${documentoReceita ? 'border-emerald-400 bg-white' : 'border-blue-200 bg-white/70 hover:border-blue-400'}`}>
                <input
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={e => setDocumentoReceita(e.target.files?.[0] || null)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                />
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${documentoReceita ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-50 text-blue-400'}`}>
                    <UploadCloud size={21} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-700 truncate">
                      {documentoReceita ? documentoReceita.name : 'Selecionar scan do cadastro'}
                    </p>
                    <p className="text-xs text-slate-400">Imagem ou PDF</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-black text-slate-700">
                    <CalendarDays size={16} className="text-blue-500" />
                    Início da receita
                  </label>
                  <input
                    required
                    type="text"
                    value={receitaInicio}
                    onChange={e => setReceitaInicio(maskDate(e.target.value))}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={10}
                    placeholder="DD/MM/AAAA"
                    className="w-full px-4 py-3 text-base bg-white border-2 border-blue-100 rounded-2xl focus:border-blue-500 outline-none transition-all text-slate-800 font-medium"
                  />
                </div>
                <div className="rounded-2xl bg-white border border-blue-100 px-4 py-3 min-w-[160px]">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vencimento</p>
                  <p className="text-sm font-black text-slate-800">
                    {parseDateToDB(receitaInicio) ? formatDateBR(getPrescriptionEndDate(parseDateToDB(receitaInicio)!)) : 'A calcular'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 px-6 py-4 sm:px-7 bg-slate-50/90 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 text-slate-500 font-bold text-base rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base rounded-2xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
            >
              {loading
                ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvando...</>
                : 'Cadastrar'
              }
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
