import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSupabase, explainSupabaseError } from '../lib/supabase';
import {
  ArrowLeft, FileText, Receipt, Plus, X, UploadCloud,
  ChevronRight, Download, Printer, ZoomIn, ZoomOut, Maximize2,
  FolderOpen, User, CheckCircle2, AlertTriangle, CalendarDays,
  FileCheck2, ScrollText, ShieldCheck, SlidersHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  buildPrescriptionMeta,
  formatDateBR,
  getDocumentName,
  getLatestPrescription,
  getPrescriptionEndDate,
  getPrescriptionStatus,
  isPdfDocument,
  parsePrescriptionMeta,
} from '../lib/documents';
import { isFutureDate, maskDate, parseDateToDB } from '../lib/validators';
import { prepareDocumentForUpload, checkFileFeasibility } from '../lib/media-compression';
import { buildDocumentPath, documentBucket, resolveDocumentRows, resolveDocumentUrl } from '../lib/storage';
import { useAuth } from '../auth/AuthContext';

type DocumentTab = 'receita' | 'documento' | 'procuracao';

const documentTabs: Array<{ key: DocumentTab; label: string; icon: any }> = [
  { key: 'receita', label: 'Receitas', icon: FileText },
  { key: 'documento', label: 'Documentos', icon: FileCheck2 },
  { key: 'procuracao', label: 'Procurações', icon: ScrollText },
];

const getDocumentTabDescription = (tab: DocumentTab) => {
  if (tab === 'documento') return 'RG, CPF e outros documentos do paciente';
  if (tab === 'procuracao') return 'Procurações mantidas no histórico do paciente';
  return 'Histórico completo, sem excluir receitas antigas';
};

const inDateRange = (value: string | undefined, start: string, end: string) => {
  if (!value) return false;
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  if (start) {
    const startDate = new Date(`${start}T00:00:00`);
    startDate.setHours(0, 0, 0, 0);
    if (date < startDate) return false;
  }
  if (end) {
    const endDate = new Date(`${end}T23:59:59`);
    endDate.setHours(23, 59, 59, 999);
    if (date > endDate) return false;
  }
  return true;
};

const getFilterDateForDoc = (doc: any) => {
  if (doc.tipo === 'receita') {
    const meta = parsePrescriptionMeta(doc);
    return meta.inicio || doc.created_at;
  }
  return doc.created_at;
};

// ─── VISUALIZADOR FULLSCREEN ────────────────────────────────────────────────
function FullscreenViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [renderAsPdf, setRenderAsPdf] = useState(isPdfDocument(url, title));
  const [imgError, setImgError] = useState(false);
  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (win) {
      const tag = renderAsPdf || imgError ? 'iframe' : 'img';
      win.document.write(`<html lang="pt-BR" translate="no"><body class="notranslate" translate="no" style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;"><${tag} src="${url}" style="width:100%;height:100%;border:0;object-fit:contain;"></${tag}></body></html>`);
      win.document.close(); win.focus();
      setTimeout(() => { win.print(); win.close(); }, 500);
    }
  };
  const handleDownload = async () => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = blob.type?.includes('pdf') ? '.pdf' : '.jpg';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/\s+/g, '_')}${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { console.error(e); }
  };
  const showAsPdf = renderAsPdf || imgError;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/95 z-[100] flex flex-col pt-16">
      <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-10 bg-black/40 backdrop-blur-md border-b border-white/5">
        <h3 className="text-white font-black text-sm tracking-widest px-4">{title}</h3>
        <div className="flex items-center gap-2 pr-4">
          <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} className="p-2 text-white/70 hover:text-white"><ZoomOut size={22} /></button>
          <button onClick={() => setZoom(z => Math.min(z + 0.25, 3))} className="p-2 text-white/70 hover:text-white"><ZoomIn size={22} /></button>
          <button onClick={handlePrint} className="p-2 text-white/70 hover:text-white ml-2"><Printer size={22} /></button>
          <button onClick={handleDownload} className="p-2 text-white/70 hover:text-white"><Download size={22} /></button>
          <button onClick={onClose} className="p-2 bg-red-500 text-white rounded-full ml-4 hover:scale-110 transition-transform"><X size={20} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8 bg-slate-100">
        {showAsPdf ? (
          <iframe src={url} title={title} className="w-full h-full bg-white rounded-xl shadow-2xl border border-slate-200" />
        ) : (
          <img src={url} alt={title} onError={() => setImgError(true)}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.2s' }}
            className="max-h-full max-w-full rounded-xl shadow-2xl bg-white" />
        )}
      </div>
    </motion.div>
  );
}

// ─── LINHA DE DOCUMENTO ──────────────────────────────────────────────────────
function DocRow({ doc, onView }: { doc: any; onView: (doc: any) => void }) {
  const name = getDocumentName(doc);
  const isPdf = isPdfDocument(doc.url, name);
  return (
    <button onClick={() => onView(doc)}
      className="w-full flex items-center justify-between p-4 bg-white hover:bg-blue-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-all group text-left">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
          {isPdf ? <FileText size={18} className="text-slate-400" /> : <img src={doc.url} className="w-full h-full object-cover" alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
        </div>
        <span className="text-sm font-semibold text-slate-700 truncate">{name}</span>
      </div>
      <Maximize2 size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0 ml-3" />
    </button>
  );
}

// ─── UPLOAD BOX ──────────────────────────────────────────────────────────────
function UploadBox({ tipo, label, descricao, files, onAdd, colorClass, borderClass, Icon, obrigatorio, inputKey, disabled, checking }: any) {
  const ok = files.length > 0;
  const inputId = `${tipo}-upload-${inputKey}`;
  const formatSize = (size: number) => size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition-all bg-white ${ok ? borderClass : 'border-slate-200'}`}>
      <div className={`px-4 py-3 flex items-center justify-between gap-3 ${ok ? colorClass : 'bg-slate-50'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ok ? 'bg-white/70' : 'bg-white text-slate-400'}`}>
            <Icon size={20} className={ok ? '' : 'text-slate-400'} />
          </div>
          <div>
            <p className="font-bold text-sm">{label}{obrigatorio && <span className="text-red-400 ml-1">*</span>}</p>
            <p className="text-xs opacity-70">{descricao}</p>
          </div>
        </div>
        {ok && <span className="text-xs font-bold px-3 py-1 bg-white/60 rounded-full">✓ {files.length} arquivo{files.length > 1 ? 's' : ''}</span>}
      </div>
      {ok && (
        <div className="px-4 pt-2 pb-1 space-y-1 bg-white border-t border-slate-100">
          {files.map((f: File, i: number) => (
            <div key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center justify-between gap-3 py-2 px-3 bg-slate-50 rounded-xl">
              <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700 font-bold truncate">{f.name}</p>
                <p className="text-xs text-slate-400 font-semibold">{formatSize(f.size)} · será salvo como novo arquivo</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="bg-white border-t border-dashed border-slate-200">
        <input key={inputKey} id={inputId} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onAdd} disabled={disabled} className="sr-only" />
        <label htmlFor={inputId} className={`flex min-h-12 items-center justify-center gap-2 px-4 py-3 transition-colors ${disabled ? 'cursor-not-allowed text-slate-300' : 'cursor-pointer text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
          {checking ? <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : <UploadCloud size={17} />}
          <span className="text-sm font-bold">{checking ? 'Validando arquivo...' : ok ? 'Adicionar outro cupom' : 'Adicionar cupom fiscal'}</span>
        </label>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────────
export default function ClientProfile() {
  const { profile } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState<any>(null);
  const [visitas, setVisitas] = useState<any[]>([]);
  const [allDocs, setAllDocs] = useState<any[]>([]);
  const [selectedVisitaId, setSelectedVisitaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState<DocumentTab | null>(null);
  const [documentTab, setDocumentTab] = useState<DocumentTab>('receita');
  const [fileStartDate, setFileStartDate] = useState('');
  const [fileEndDate, setFileEndDate] = useState('');
  const [showFileFilters, setShowFileFilters] = useState(false);
  const [recordStartDate, setRecordStartDate] = useState('');
  const [recordEndDate, setRecordEndDate] = useState('');
  const [showRecordFilters, setShowRecordFilters] = useState(false);
  const [modalDoc, setModalDoc] = useState<{ url: string; title: string } | null>(null);

  const fetchData = async () => {
    const supabase = getSupabase();
    if (!supabase || !id) return;
    try {
      setLoading(true);
      setLoadError('');
      const { data: cData, error: clientError } = await supabase.from('clientes')
        .select('id, nome_completo, url_identidade_frontal, created_at').eq('id', id).single();
      if (clientError) throw clientError;
      const signedIdentityUrl = await resolveDocumentUrl(cData.url_identidade_frontal);
      setClient({ ...cData, url_identidade_frontal: signedIdentityUrl || cData.url_identidade_frontal });
      const { data: vendasData, error: salesError } = await supabase.from('vendas')
        .select('id, created_at, data_venda').eq('cliente_id', id).order('data_venda', { ascending: false });
      if (salesError) throw salesError;
      setVisitas(vendasData || []);
      const { data: docsData, error: docsError } = await supabase.from('vendas_documentos')
        .select('*').eq('cliente_id', id);
      if (docsError) throw docsError;
      setAllDocs(await resolveDocumentRows(docsData || []));
    } catch (err: any) { setLoadError(explainSupabaseError(err)); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (loadError) return (
    <div className="max-w-lg mx-auto mt-12 rounded-lg border border-red-100 bg-white p-6 text-center">
      <AlertTriangle size={30} className="mx-auto text-red-500" />
      <p className="mt-3 font-black text-slate-900">Não foi possível carregar o paciente</p>
      <p className="mt-1 text-sm font-semibold text-slate-500">{loadError}</p>
      <button type="button" onClick={fetchData} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800">Tentar novamente</button>
    </div>
  );
  if (!client) return <div className="p-12 text-center text-slate-400 font-bold">Cliente não encontrado</div>;

  const selectedVisita = visitas.find(v => v.id === selectedVisitaId);
  const visitaDocs = allDocs.filter(d => d.venda_id === selectedVisitaId);
  const cupomDocs   = visitaDocs.filter(d => d.tipo === 'cupom');
  const receitaDocs = allDocs.filter(d => d.tipo === 'receita');
  const receitaHistorico = [...receitaDocs].sort((a, b) =>
    parsePrescriptionMeta(b).inicio.localeCompare(parsePrescriptionMeta(a).inicio)
  );
  const receitaAtual = getLatestPrescription(receitaDocs);
  const receitaStatus = receitaAtual ? getPrescriptionStatus(receitaAtual) : null;
  const docsPerVisita = (vid: string) => allDocs.filter(d => d.venda_id === vid);
  const documentoCadastro = client.url_identidade_frontal ? {
    id: 'cadastro-principal',
    tipo: 'documento',
    url: client.url_identidade_frontal,
    nome_arquivo: 'Cadastro RG/CPF',
    created_at: client.created_at,
    isCadastro: true,
  } : null;
  const documentosDocs = [
    ...(documentoCadastro ? [documentoCadastro] : []),
    ...allDocs.filter(d => d.tipo === 'documento'),
  ];
  const procuracaoDocs = allDocs.filter(d => d.tipo === 'procuracao');
  const docsByTab: Record<DocumentTab, any[]> = {
    receita: receitaHistorico,
    documento: documentosDocs,
    procuracao: procuracaoDocs,
  };
  const activeDocsBase = docsByTab[documentTab] || [];
  const hasFileDateFilter = Boolean(fileStartDate || fileEndDate);
  const activeDocs = activeDocsBase.filter(doc => !hasFileDateFilter || inDateRange(getFilterDateForDoc(doc), fileStartDate, fileEndDate));
  const hasRecordDateFilter = Boolean(recordStartDate || recordEndDate);
  const filteredVisitas = visitas.filter(visita => !hasRecordDateFilter || inDateRange(visita.data_venda || visita.created_at, recordStartDate, recordEndDate));

  const setFilePeriod = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    setFileStartDate(format(start, 'yyyy-MM-dd'));
    setFileEndDate(format(end, 'yyyy-MM-dd'));
  };

  const setFileCurrentMonth = () => {
    const now = new Date();
    setFileStartDate(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
    setFileEndDate(format(now, 'yyyy-MM-dd'));
  };

  const clearFilePeriod = () => {
    setFileStartDate('');
    setFileEndDate('');
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto p-4 md:p-8 pb-24 space-y-5">

      {/* ── CABEÇALHO ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => selectedVisitaId ? setSelectedVisitaId(null) : navigate('/clientes')}
          className="p-2 hover:bg-slate-200 rounded-full transition-colors flex-shrink-0">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-blue-500 uppercase tracking-widest">
            {selectedVisita
              ? `← Registro de ${format(parseISO(selectedVisita.data_venda || selectedVisita.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`
              : 'Ficha do Paciente'}
          </p>
          <h1 className="text-2xl font-black text-slate-900 truncate">{client.nome_completo}</h1>
        </div>
        {!selectedVisitaId && (
          <button onClick={() => setShowNewModal(true)}
            className="bg-blue-600 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-blue-200 hover:-translate-y-0.5 transition-all flex items-center gap-2 flex-shrink-0">
            <Plus size={18} /> Novo Registro
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!selectedVisitaId ? (
          /* ══ VISTA: LISTA DE REGISTROS ══ */
          <motion.div key="lista" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">

            <div className={`rounded-lg border p-4 sm:p-5 ${receitaStatus && !receitaStatus.vencida && !receitaStatus.aindaNaoIniciada ? 'bg-white border-emerald-200' : 'bg-white border-amber-200'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${receitaStatus && !receitaStatus.vencida && !receitaStatus.aindaNaoIniciada ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                    {receitaStatus && !receitaStatus.vencida && !receitaStatus.aindaNaoIniciada ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Situação fiscal</p>
                    <h2 className="text-xl font-black text-slate-950 truncate">
                      {receitaAtual ? getDocumentName(receitaAtual) : 'Sem receita vigente'}
                    </h2>
                    {receitaStatus ? (
                      <p className="text-sm font-semibold text-slate-600 mt-1">
                        Início {formatDateBR(receitaStatus.inicio)} · vencimento {formatDateBR(receitaStatus.vencimento)}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-amber-700 mt-1">Cadastre uma receita para liberar novas compras.</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 min-w-full lg:min-w-[260px]">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</p>
                    <p className={`text-sm font-black ${receitaStatus?.vencida ? 'text-red-600' : 'text-emerald-700'}`}>
                      {receitaStatus ? (receitaStatus.vencida ? 'Vencida' : receitaStatus.aindaNaoIniciada ? 'Início futuro' : `${receitaStatus.diasRestantes} dias`) : 'Pendente'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Receitas</p>
                    <p className="text-sm font-black text-slate-900">{receitaHistorico.length}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-white space-y-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">Arquivos do paciente</p>
                  <h3 className="text-lg font-black text-slate-900">Receitas, documentos e procurações</h3>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-400">
                    {hasFileDateFilter ? `Período: ${fileStartDate || 'início'} até ${fileEndDate || 'hoje'}` : 'Todos os arquivos'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowFileFilters(value => !value)}
                    className={`px-3 py-2 rounded-lg border text-xs font-black flex items-center gap-2 transition-colors ${showFileFilters || hasFileDateFilter ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    <SlidersHorizontal size={14} />
                    {showFileFilters ? 'Ocultar filtro' : 'Filtrar por período'}
                  </button>
                </div>

                {showFileFilters && <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <label className="group rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-500 focus-within:bg-white transition-colors">
                    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <CalendarDays size={13} />
                      Data inicial
                    </span>
                    <input
                      type="date"
                      value={fileStartDate}
                      onChange={e => setFileStartDate(e.target.value)}
                      className="mt-1 w-full bg-transparent outline-none text-sm font-black text-slate-800 [color-scheme:light]"
                    />
                  </label>
                  <label className="group rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-500 focus-within:bg-white transition-colors">
                    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <CalendarDays size={13} />
                      Data final
                    </span>
                    <input
                      type="date"
                      value={fileEndDate}
                      onChange={e => setFileEndDate(e.target.value)}
                      className="mt-1 w-full bg-transparent outline-none text-sm font-black text-slate-800 [color-scheme:light]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={clearFilePeriod}
                    disabled={!hasFileDateFilter}
                    className="px-4 py-3 rounded-lg border border-slate-200 text-slate-500 font-black text-xs hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white flex items-center justify-center gap-2"
                  >
                    <SlidersHorizontal size={15} />
                    Limpar
                  </button>
                </div>}

                {showFileFilters && <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Hoje', onClick: () => setFilePeriod(1) },
                    { label: '7 dias', onClick: () => setFilePeriod(7) },
                    { label: '30 dias', onClick: () => setFilePeriod(30) },
                    { label: 'Este mês', onClick: setFileCurrentMonth },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={preset.onClick}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700 font-black text-[11px] transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>}
              </div>

              <div className="p-3 border-b border-slate-200 bg-slate-50">
                <div className="grid grid-cols-3 gap-2">
                  {documentTabs.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDocumentTab(key)}
                      className={`px-3 py-3 rounded-lg font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors ${
                        documentTab === key ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-white/70'
                      }`}
                    >
                      <Icon size={16} />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-black text-sm text-slate-900">
                      {documentTabs.find(tab => tab.key === documentTab)?.label}
                    </p>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black">
                      {activeDocs.length}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-400 truncate">
                    {getDocumentTabDescription(documentTab)}
                  </p>
                </div>
                {documentTab === 'receita' && (
                  <button type="button" onClick={() => setShowRecipeModal(true)} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-black text-xs hover:bg-blue-700 flex items-center justify-center gap-2">
                    <Plus size={15} /> Nova receita
                  </button>
                )}
                {documentTab === 'documento' && (
                  <button type="button" onClick={() => setShowDocumentModal('documento')} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-black text-xs hover:bg-blue-700 flex items-center justify-center gap-2">
                    <Plus size={15} /> Novo documento
                  </button>
                )}
                {documentTab === 'procuracao' && (
                  <button type="button" onClick={() => setShowDocumentModal('procuracao')} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-black text-xs hover:bg-blue-700 flex items-center justify-center gap-2">
                    <Plus size={15} /> Nova procuração
                  </button>
                )}
              </div>
              <div className="p-3 space-y-2">
                {activeDocs.length > 0 ? activeDocs.map((doc) => {
                  const status = doc.tipo === 'receita' ? getPrescriptionStatus(doc) : null;
                  const ativa = receitaAtual?.id === doc.id;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => setModalDoc({ url: doc.url, title: getDocumentName(doc) })}
                      className="w-full p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${status?.vencida ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'}`}>
                          {doc.tipo === 'receita' ? (status?.vencida ? <AlertTriangle size={19} /> : <CheckCircle2 size={19} />) : <ShieldCheck size={19} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-slate-900 truncate">{getDocumentName(doc)}</p>
                            {ativa && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest">vigente</span>}
                          </div>
                          {status ? (
                            <p className="text-xs font-semibold text-slate-400 mt-1">
                              Início {formatDateBR(status.inicio)} · vence {formatDateBR(status.vencimento)}
                            </p>
                          ) : (
                            <p className="text-xs font-semibold text-slate-400 mt-1">
                              {doc.isCadastro ? 'Arquivo original do cadastro' : `Anexado em ${doc.created_at ? format(parseISO(doc.created_at), 'dd/MM/yyyy', { locale: ptBR }) : 'data não informada'}`}
                            </p>
                          )}
                        </div>
                      </div>
                      {status && (
                        <span className={`px-3 py-1 rounded-full text-xs font-black flex-shrink-0 ${status.vencida ? 'bg-red-50 text-red-600' : status.aindaNaoIniciada ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {status.vencida ? 'Vencida' : status.aindaNaoIniciada ? 'Início futuro' : `${status.diasRestantes} dias`}
                        </span>
                      )}
                    </button>
                  );
                }) : (
                  <div className="py-8 text-center text-slate-400 font-bold">Nenhum arquivo nesta aba.</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Registros de compra</p>
                  <h3 className="text-lg font-black text-slate-900">
                    {filteredVisitas.length} registro{filteredVisitas.length !== 1 ? 's' : ''}
                  </h3>
                </div>
                <button type="button" onClick={() => setShowRecordFilters(value => !value)} className={`px-3 py-2 rounded-lg border text-xs font-black flex items-center gap-2 ${showRecordFilters || hasRecordDateFilter ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  <SlidersHorizontal size={14} /> {showRecordFilters ? 'Ocultar filtro' : 'Filtrar por período'}
                </button>
              </div>

              {showRecordFilters && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <label className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-500">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Data inicial</span>
                    <input type="date" value={recordStartDate} onChange={event => setRecordStartDate(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-black text-slate-800 outline-none" />
                  </label>
                  <label className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-500">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Data final</span>
                    <input type="date" value={recordEndDate} onChange={event => setRecordEndDate(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-black text-slate-800 outline-none" />
                  </label>
                  <button type="button" disabled={!hasRecordDateFilter} onClick={() => { setRecordStartDate(''); setRecordEndDate(''); }} className="px-4 py-3 rounded-lg border border-slate-200 text-slate-500 font-black text-xs hover:bg-slate-50 disabled:opacity-40">Limpar</button>
                </div>
              )}

            {filteredVisitas.length === 0 && visitas.length === 0 ? (
              <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center space-y-4">
                <FolderOpen size={44} className="mx-auto text-slate-300" />
                <div>
                  <p className="text-lg font-bold text-slate-700">Nenhum registro ainda</p>
                  <p className="text-sm text-slate-400 mt-1">Siga os passos abaixo para registrar a primeira compra</p>
                </div>
                <div className="text-left max-w-xs mx-auto space-y-3 pt-2">
                  {[
                    { n: '1', txt: 'Clique em "Novo Registro" (botão azul acima)' },
                    { n: '2', txt: 'Confira se a receita vigente ainda está válida' },
                    { n: '3', txt: 'Anexe o Cupom Fiscal da compra' },
                    { n: '4', txt: 'Salve a compra para auditoria' },
                  ].map(s => (
                    <div key={s.n} className="flex items-start gap-3">
                      <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-black text-sm flex items-center justify-center flex-shrink-0">{s.n}</span>
                      <p className="text-sm text-slate-600 pt-0.5">{s.txt}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowNewModal(true)}
                  className="mt-4 bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold text-base shadow-lg shadow-blue-200 hover:-translate-y-0.5 transition-all inline-flex items-center gap-2">
                  <Plus size={18} /> Criar Primeiro Registro
                </button>
              </div>
            ) : filteredVisitas.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <CalendarDays size={30} className="mx-auto text-slate-300" />
                <p className="mt-3 font-black text-slate-700">Nenhum registro neste período</p>
                <p className="mt-1 text-sm font-semibold text-slate-400">Ajuste as datas ou limpe o filtro.</p>
              </div>
            ) : (
              <>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">
                  Clique em um registro para ver os documentos da compra
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredVisitas.map((v, i) => {
                    const docs = docsPerVisita(v.id);
                    const temCupom   = docs.some(d => d.tipo === 'cupom');
                    return (
                      <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all group">
                        {/* Área clicável para abrir */}
                        <button className="w-full p-5 text-left" onClick={() => setSelectedVisitaId(v.id)}>
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-lg font-black text-slate-900">
                                {format(parseISO(v.data_venda || v.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                              </p>
                              <p className="text-sm text-slate-400 font-medium">
                                {format(parseISO(v.data_venda || v.created_at), 'HH:mm', { locale: ptBR })}
                              </p>
                            </div>
                            <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500 transition-colors mt-1" />
                          </div>
                          <div className="flex gap-2 mt-3 flex-wrap">
                            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${temCupom ? 'bg-indigo-100 text-indigo-700' : 'bg-red-50 text-red-400'}`}>
                              <Receipt size={10} /> Cupom {!temCupom && '(falta)'}
                            </span>
                          </div>
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              </>
            )}
            </div>
          </motion.div>
        ) : (
          /* ══ VISTA: DOCUMENTOS DO REGISTRO ══ */
          <motion.div key="detalhe" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }} className="space-y-4">

            {/* Receitas */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 flex items-center gap-3">
                <FileText size={20} className="text-blue-600" />
                <div>
                  <p className="font-black text-sm text-blue-800">Histórico de Receitas</p>
                  <p className="text-xs text-blue-500">{receitaDocs.length} receita{receitaDocs.length !== 1 ? 's' : ''} preservada{receitaDocs.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="p-3 space-y-2">
                {receitaDocs.length > 0
                  ? receitaDocs.map(d => {
                    const meta = parsePrescriptionMeta(d);
                    return (
                      <div key={d.id} className="space-y-1">
                        <DocRow doc={d} onView={d => setModalDoc({ url: d.url, title: getDocumentName(d) })} />
                        <p className="px-2 text-xs font-semibold text-slate-400">Início {formatDateBR(meta.inicio)} · Vence {formatDateBR(meta.vencimento)}</p>
                      </div>
                    );
                  })
                  : <p className="py-5 text-center text-sm text-slate-300 font-medium">Nenhuma receita anexada</p>}
              </div>
            </div>

            {/* Cupons */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-indigo-50 border-b border-indigo-100 flex items-center gap-3">
                <Receipt size={20} className="text-indigo-600" />
                <div>
                  <p className="font-black text-sm text-indigo-800">Cupom Fiscal</p>
                  <p className="text-xs text-indigo-500">{cupomDocs.length} arquivo{cupomDocs.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="p-3 space-y-2">
                {cupomDocs.length > 0
                  ? cupomDocs.map(d => <DocRow key={d.id} doc={d} onView={d => setModalDoc({ url: d.url, title: getDocumentName(d) || 'Cupom' })} />)
                  : <p className="py-5 text-center text-sm text-slate-300 font-medium">Nenhum cupom anexado</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewModal && (
          <NewRegistroModal farmaciaId={profile!.farmacia_id} client={client} receitaStatus={receitaStatus} onClose={() => setShowNewModal(false)} onAdded={fetchData} />
        )}
        {showRecipeModal && (
          <NewPrescriptionModal farmaciaId={profile!.farmacia_id} client={client} onClose={() => setShowRecipeModal(false)} onAdded={fetchData} />
        )}
        {showDocumentModal && (
          <NewPatientDocumentModal
            client={client}
            farmaciaId={profile!.farmacia_id}
            tipo={showDocumentModal}
            onClose={() => setShowDocumentModal(null)}
            onAdded={fetchData}
          />
        )}
        {modalDoc && <FullscreenViewer url={modalDoc.url} title={modalDoc.title} onClose={() => setModalDoc(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── MODAL: NOVO REGISTRO ────────────────────────────────────────────────────
function NewRegistroModal({ farmaciaId, client, receitaStatus, onClose, onAdded }: any) {
  const [cupomFiles,   setCupomFiles]   = useState<File[]>([]);
  const [cupomInputKey, setCupomInputKey] = useState(0);
  const [checkingCupom, setCheckingCupom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]     = useState('');

  const handleCupomSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.currentTarget.files?.[0] || null;
    setCupomInputKey(key => key + 1);
    setError('');
    if (!selectedFile) return;

    setCheckingCupom(true);
    try {
      const feasibilityError = await checkFileFeasibility(selectedFile);
      if (feasibilityError) {
        setError(feasibilityError);
        return;
      }
      const fingerprint = `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`;
      setCupomFiles(currentFiles => {
        const alreadyAdded = currentFiles.some(file => `${file.name}:${file.size}:${file.lastModified}` === fingerprint);
        if (alreadyAdded) {
          setError('Este cupom já foi adicionado neste registro.');
          return currentFiles;
        }
        return [...currentFiles, selectedFile];
      });
    } finally {
      setCheckingCupom(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receitaStatus) { setError('Cadastre uma receita antes de concluir a compra.'); return; }
    if (receitaStatus.aindaNaoIniciada) { setError('A receita ainda não iniciou. Confira a data ou aguarde o início da vigência.'); return; }
    if (receitaStatus.vencida) { setError('Receita vencida. Anexe uma nova receita antes de concluir a compra.'); return; }
    if (checkingCupom) { setError('Aguarde a validação do cupom fiscal.'); return; }
    if (cupomFiles.length === 0) { setError('Anexe o Cupom Fiscal desta compra.'); return; }

    setLoading(true); setError(''); setStatusMsg('');
    const supabase = getSupabase();
    if (!supabase) {
      setError('Não foi possível conectar ao banco. Atualize a página e tente novamente.');
      setLoading(false);
      return;
    }

    for (const cupom of cupomFiles) {
      const feasibilityErr = await checkFileFeasibility(cupom);
      if (feasibilityErr) { setError(feasibilityErr); setLoading(false); return; }
    }

    try {
      const { data: venda, error: vErr } = await supabase.from('vendas')
        .insert([{
          farmacia_id: farmaciaId,
          cliente_id: client.id,
        }])
        .select().single();
      if (vErr) throw vErr;
      const pendingDocuments: Array<{ farmacia_id: string; venda_id: string; cliente_id: string; tipo: string; url: string; nome_arquivo: string }> = [];
      const uploadDocs = async (files: File[], tipo: string) => {
        for (const f of files) {
          const prepared = await prepareDocumentForUpload(f, (status) => {
            setStatusMsg(status === 'optimizing' ? 'Otimizando arquivo...' : status === 'uploading' ? 'Enviando documento...' : 'Preparando documento...');
          });
          const fileToUpload = prepared.file;
          const ext  = fileToUpload.name.split('.').pop();
          const path = buildDocumentPath(farmaciaId, tipo, `${tipo}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
          const { error: upErr } = await supabase.storage.from(documentBucket).upload(path, fileToUpload, {
            contentType: fileToUpload.type,
          });
          if (upErr) throw upErr;
          pendingDocuments.push({
            farmacia_id: farmaciaId,
            venda_id: venda.id, cliente_id: client.id,
            tipo, url: path, nome_arquivo: f.name,
          });
        }
      };

      await uploadDocs(cupomFiles, 'cupom');
      const { error: documentError } = await supabase.from('vendas_documentos').insert(pendingDocuments);
      if (documentError) throw documentError;
      onAdded(); onClose();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally { setLoading(false); setStatusMsg(''); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden border border-slate-100">
        <div className="px-6 py-5 sm:px-7 flex justify-between items-start gap-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] font-black text-blue-500">Dispensação</p>
            <h2 className="text-2xl font-black text-slate-900">Novo Registro</h2>
            <p className="text-sm text-slate-400 mt-1 truncate">{client.nome_completo}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-xl flex-shrink-0"><X size={22} /></button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 space-y-5">
            {statusMsg && <div className="p-4 bg-blue-50 text-blue-700 rounded-2xl text-sm font-semibold border border-blue-100 flex items-center gap-2"><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />{statusMsg}</div>}
            {error && <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm font-semibold border border-red-100">⚠️ {error}</div>}

            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Registro da compra</p>
                  <p className="text-xs font-semibold text-slate-400">A data e hora serão registradas automaticamente.</p>
                </div>
                <span className="hidden sm:inline-flex px-3 py-1 rounded-full bg-white border border-slate-200 text-[10px] uppercase tracking-widest font-black text-slate-500">Hoje</span>
              </div>
            </div>

            {receitaStatus ? (
              <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${receitaStatus.vencida ? 'bg-red-50 border-red-100 text-red-700' : receitaStatus.aindaNaoIniciada ? 'bg-amber-50 border-amber-100 text-amber-800' : 'bg-emerald-50 border-emerald-100 text-emerald-800'}`}>
                {receitaStatus.vencida || receitaStatus.aindaNaoIniciada ? <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-black">{receitaStatus.vencida ? 'Receita vencida' : receitaStatus.aindaNaoIniciada ? 'Receita ainda não iniciada' : 'Receita válida para esta compra'}</p>
                  <p className="text-xs font-semibold opacity-80">
                    Início {formatDateBR(receitaStatus.inicio)} · Vence {formatDateBR(receitaStatus.vencimento)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 text-amber-800 px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-black">Receita obrigatória</p>
                  <p className="text-xs font-semibold opacity-80">Cadastre uma receita antes de registrar compras.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              <UploadBox tipo="cupom" label="Cupons Fiscais" descricao="Cada seleção cria um novo arquivo nesta compra"
                files={cupomFiles} onAdd={handleCupomSelection}
                inputKey={cupomInputKey} disabled={loading || checkingCupom} checking={checkingCupom}
                colorClass="bg-indigo-50 text-indigo-700" borderClass="border-indigo-400" Icon={Receipt} obrigatorio />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className={`rounded-2xl px-4 py-3 border ${cupomFiles.length ? 'bg-indigo-50 border-indigo-100 text-indigo-700' : 'bg-white border-slate-100 text-slate-400'}`}>
                <p className="text-xs font-black uppercase tracking-widest">Cupom</p>
                <p className="text-2xl font-black">{cupomFiles.length}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 sm:px-7 flex gap-3 bg-slate-50 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 font-bold text-slate-500 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-100 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading || checkingCupom}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20">
              {loading
                ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Salvando...</>
                : <><CheckCircle2 size={18} />Salvar Registro</>}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function NewPrescriptionModal({ farmaciaId, client, onClose, onAdded }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [inicio, setInicio] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const inicioDb = parseDateToDB(inicio);
  const vencimento = inicioDb ? getPrescriptionEndDate(inicioDb) : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    if (!file) { setError('Anexe a nova receita.'); return; }
    if (!inicioDb) { setError('Informe a data de início da receita.'); return; }
    if (isFutureDate(inicioDb)) { setError('A data de início da receita não pode estar no futuro.'); return; }

    setLoading(true);
    setError(''); setStatusMsg('');

    const feasibilityErr = await checkFileFeasibility(file);
    if (feasibilityErr) { setError(feasibilityErr); setLoading(false); return; }

    try {
      const prepared = await prepareDocumentForUpload(file, (status) => {
        setStatusMsg(status === 'optimizing' ? 'Otimizando arquivo...' : status === 'uploading' ? 'Enviando documento...' : 'Preparando documento...');
      });
      const fileToUpload = prepared.file;
      const ext = fileToUpload.name.split('.').pop();
      const path = buildDocumentPath(farmaciaId, 'receita', `receita_${client.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
      const { error: upErr } = await supabase.storage.from(documentBucket).upload(path, fileToUpload, {
        contentType: fileToUpload.type,
      });
      if (upErr) throw upErr;
      const { error: insertError } = await supabase.from('vendas_documentos').insert([{
        farmacia_id: farmaciaId,
        venda_id: null,
        cliente_id: client.id,
        tipo: 'receita',
        url: path,
        nome_arquivo: buildPrescriptionMeta(file.name, inicioDb),
      }]);
      if (insertError) throw insertError;
      onAdded();
      onClose();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-hidden border border-slate-100 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] font-black text-blue-500">Histórico fiscal</p>
            <h2 className="text-2xl font-black text-slate-900">Nova receita</h2>
            <p className="text-sm text-slate-400 mt-1">A receita anterior permanece salva para auditoria.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-xl"><X size={22} /></button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {statusMsg && <div className="p-4 bg-blue-50 text-blue-700 rounded-2xl text-sm font-semibold border border-blue-100 flex items-center gap-2"><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />{statusMsg}</div>}
            {error && <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm font-semibold border border-red-100">⚠️ {error}</div>}

            <div className={`relative rounded-2xl border-2 border-dashed transition-all overflow-hidden ${file ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}`}>
              <input
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              />
              <div className="flex items-center gap-3 px-4 py-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${file ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-300'}`}>
                  <UploadCloud size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-700 truncate">{file ? file.name : 'Selecionar nova receita'}</p>
                  <p className="text-xs text-slate-400">Imagem ou PDF</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">Início da receita</label>
                <input
                  required
                  value={inicio}
                  onChange={e => setInicio(maskDate(e.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={10}
                  placeholder="DD/MM/AAAA"
                  className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 outline-none font-semibold"
                />
              </div>
              <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Vencimento calculado</p>
                <p className="text-lg font-black text-slate-900 mt-1">{vencimento ? formatDateBR(vencimento) : 'A calcular'}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 font-bold text-slate-500 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-100">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2">
              <CheckCircle2 size={18} />
              {loading ? 'Salvando...' : 'Salvar receita'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function NewPatientDocumentModal({ farmaciaId, client, tipo, onClose, onAdded }: { farmaciaId: string; client: any; tipo: DocumentTab; onClose: () => void; onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const isProcuracao = tipo === 'procuracao';
  const title = isProcuracao ? 'Nova procuração' : 'Novo documento';
  const storageFolder = isProcuracao ? 'procuracao' : 'documentos';
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    if (!file) { setError('Selecione um arquivo para anexar.'); return; }

    setLoading(true);
    setError('');
    setStatusMsg('');

    const feasibilityErr = await checkFileFeasibility(file);
    if (feasibilityErr) { setError(feasibilityErr); setLoading(false); return; }

    try {
      const prepared = await prepareDocumentForUpload(file, (status) => {
        setStatusMsg(status === 'optimizing' ? 'Otimizando arquivo...' : status === 'uploading' ? 'Enviando documento...' : 'Preparando documento...');
      });
      const fileToUpload = prepared.file;
      const ext = fileToUpload.name.split('.').pop();
      const path = buildDocumentPath(farmaciaId, storageFolder, `${storageFolder}_${client.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
      const { error: upErr } = await supabase.storage.from(documentBucket).upload(path, fileToUpload, {
        contentType: fileToUpload.type,
      });
      if (upErr) throw upErr;
      const { error: insertError } = await supabase.from('vendas_documentos').insert([{
        farmacia_id: farmaciaId,
        venda_id: null,
        cliente_id: client.id,
        tipo,
        url: path,
        nome_arquivo: file.name,
      }]);
      if (insertError) throw insertError;
      onAdded();
      onClose();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-hidden border border-slate-100 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] font-black text-blue-500">Arquivo do paciente</p>
            <h2 className="text-2xl font-black text-slate-900">{title}</h2>
            <p className="text-sm text-slate-400 mt-1">{client.nome_completo}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-xl"><X size={22} /></button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {statusMsg && <div className="p-4 bg-blue-50 text-blue-700 rounded-2xl text-sm font-semibold border border-blue-100 flex items-center gap-2"><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />{statusMsg}</div>}
            {error && <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm font-semibold border border-red-100">⚠️ {error}</div>}

            <div className={`relative rounded-2xl border-2 border-dashed transition-all overflow-hidden ${file ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}`}>
              <input
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              />
              <div className="flex items-center gap-3 px-4 py-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${file ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-300'}`}>
                  <UploadCloud size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-700 truncate">{file ? file.name : `Selecionar ${isProcuracao ? 'procuração' : 'documento'}`}</p>
                  <p className="text-xs text-slate-400">Imagem ou PDF</p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 font-bold text-slate-500 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-100">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2">
              <CheckCircle2 size={18} />
              {loading ? 'Salvando...' : 'Salvar arquivo'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
