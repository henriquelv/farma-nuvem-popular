import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSupabase, explainSupabaseError } from '../lib/supabase';
import {
  ArrowLeft, FileText, Receipt, Plus, X, UploadCloud,
  ChevronRight, Download, Printer, ZoomIn, ZoomOut, Maximize2,
  FolderOpen, Copy, User, CheckCircle2, AlertTriangle, CalendarDays
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
import { maskDate, parseDateToDB } from '../lib/validators';
import { compressImage, validateFileSize } from '../lib/media-compression';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

// ─── VISUALIZADOR FULLSCREEN ────────────────────────────────────────────────
function FullscreenViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const isPdf = isPdfDocument(url, title);
  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><body style="margin:0;background:#fff;"><${isPdf ? 'iframe' : 'img'} src="${url}" style="width:100%;height:100%;border:0;object-fit:contain;"></${isPdf ? 'iframe' : 'img'}></body></html>`);
      win.document.close(); win.focus();
      setTimeout(() => { win.print(); win.close(); }, 500);
    }
  };
  const handleDownload = async () => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { console.error(e); }
  };
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
        {isPdf ? (
          <iframe src={url} title={title} className="w-full h-full bg-white rounded-xl shadow-2xl border border-slate-200" />
        ) : (
          <img src={url} alt={title} style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.2s' }}
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
function UploadBox({ tipo, label, descricao, files, onAdd, onRemove, colorClass, borderClass, Icon, obrigatorio }: any) {
  const ok = files.length > 0;
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
            <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-slate-50 rounded-xl">
              <span className="text-sm text-slate-600 font-medium truncate flex-1">{f.name}</span>
              <button type="button" onClick={() => onRemove(i)} className="ml-3 text-slate-300 hover:text-red-500 flex-shrink-0"><X size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="relative bg-white border-t border-dashed border-slate-200">
        <input type="file" multiple accept="image/*,application/pdf" onChange={onAdd}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" />
        <div className="flex items-center justify-center gap-2 py-3 text-slate-400 hover:text-slate-600 cursor-pointer transition-colors">
          <UploadCloud size={17} />
          <span className="text-sm font-semibold">{ok ? 'Adicionar mais' : 'Clique para selecionar'}</span>
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────────
export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState<any>(null);
  const [visitas, setVisitas] = useState<any[]>([]);
  const [allDocs, setAllDocs] = useState<any[]>([]);
  const [selectedVisitaId, setSelectedVisitaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<any | null>(null);
  const [modalDoc, setModalDoc] = useState<{ url: string; title: string } | null>(null);

  const fetchData = async () => {
    const supabase = getSupabase();
    if (!supabase || !id) return;
    try {
      setLoading(true);
      const { data: cData } = await supabase.from('clientes')
        .select('id, nome_completo, url_identidade_frontal').eq('id', id).single();
      setClient(cData);
      const { data: vendasData } = await supabase.from('vendas')
        .select('id, created_at, data_venda, nome_medicamento, valor').eq('cliente_id', id).order('data_venda', { ascending: false });
      setVisitas(vendasData || []);
      const { data: docsData } = await supabase.from('vendas_documentos')
        .select('*').eq('cliente_id', id);
      setAllDocs(docsData || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
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

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-slate-100 flex-shrink-0 overflow-hidden border-2 border-slate-200 flex items-center justify-center">
                  {client.url_identidade_frontal
                    ? isPdfDocument(client.url_identidade_frontal, 'Cadastro')
                      ? <button onClick={() => setModalDoc({ url: client.url_identidade_frontal, title: 'Cadastro RG/CPF' })} className="w-full h-full flex items-center justify-center text-blue-500"><FileText size={28} /></button>
                      : <img src={client.url_identidade_frontal} className="w-full h-full object-cover"
                          onClick={() => setModalDoc({ url: client.url_identidade_frontal, title: 'Cadastro RG/CPF' })}
                          style={{ cursor: 'pointer' }} alt="Cadastro" />
                    : <div className="w-full h-full flex items-center justify-center text-slate-300"><User size={28} /></div>
                  }
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Documento do cadastro</p>
                  <p className="text-sm font-bold text-slate-700 mt-0.5">
                    {client.url_identidade_frontal ? 'RG/CPF salvo' : 'Não cadastrado'}
                  </p>
                  {client.url_identidade_frontal && (
                    <button onClick={() => setModalDoc({ url: client.url_identidade_frontal, title: 'Cadastro RG/CPF' })}
                      className="text-xs text-blue-500 font-bold mt-1 hover:underline">Ver arquivo</button>
                  )}
                </div>
              </div>

              <div className={`rounded-2xl border shadow-sm p-5 ${receitaStatus && !receitaStatus.vencida ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${receitaStatus && !receitaStatus.vencida ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                      {receitaStatus && !receitaStatus.vencida ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Receita vigente</p>
                      <p className="text-lg font-black text-slate-900 truncate">
                        {receitaAtual ? getDocumentName(receitaAtual) : 'Nenhuma receita cadastrada'}
                      </p>
                      {receitaStatus ? (
                        <p className="text-sm font-bold text-slate-600 mt-1">
                          Início {formatDateBR(receitaStatus.inicio)} · Vence {formatDateBR(receitaStatus.vencimento)}
                        </p>
                      ) : (
                        <p className="text-sm font-bold text-amber-800 mt-1">Cadastre uma receita para liberar compras.</p>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setShowRecipeModal(true)}
                    className="px-4 py-2 rounded-xl bg-white border border-white/70 text-slate-700 font-black text-xs hover:bg-slate-50 flex-shrink-0">
                    Nova receita
                  </button>
                </div>
                {receitaStatus && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-white/70 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</p>
                      <p className={`text-sm font-black ${receitaStatus.vencida ? 'text-red-600' : 'text-emerald-700'}`}>
                        {receitaStatus.vencida ? 'Vencida' : `${receitaStatus.diasRestantes} dias restantes`}
                      </p>
                    </div>
                    <button onClick={() => setModalDoc({ url: receitaAtual.url, title: getDocumentName(receitaAtual) })}
                      className="bg-white/70 rounded-xl px-4 py-3 text-left hover:bg-white">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Auditoria</p>
                      <p className="text-sm font-black text-blue-700">{receitaHistorico.length} receita{receitaHistorico.length !== 1 ? 's' : ''}</p>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                    <FileText size={20} />
                  </div>
                  <div>
                    <p className="font-black text-sm text-slate-900">Todas as receitas</p>
                    <p className="text-xs font-semibold text-slate-400">Histórico completo preservado para auditoria fiscal</p>
                  </div>
                </div>
                <button onClick={() => setShowRecipeModal(true)}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-black text-xs hover:bg-blue-700 flex-shrink-0">
                  Nova receita
                </button>
              </div>
              <div className="p-3 space-y-2">
                {receitaHistorico.length > 0 ? receitaHistorico.map((doc) => {
                  const status = getPrescriptionStatus(doc);
                  const ativa = receitaAtual?.id === doc.id;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => setModalDoc({ url: doc.url, title: getDocumentName(doc) })}
                      className="w-full p-4 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-left flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${status.vencida ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                          {status.vencida ? <AlertTriangle size={19} /> : <CheckCircle2 size={19} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-slate-900 truncate">{getDocumentName(doc)}</p>
                            {ativa && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest">vigente</span>}
                          </div>
                          <p className="text-xs font-semibold text-slate-400 mt-1">
                            Início {formatDateBR(status.inicio)} · Vence {formatDateBR(status.vencimento)}
                          </p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-black flex-shrink-0 ${status.vencida ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                        {status.vencida ? 'Vencida' : `${status.diasRestantes} dias`}
                      </span>
                    </button>
                  );
                }) : (
                  <div className="py-8 text-center text-slate-400 font-bold">Nenhuma receita cadastrada.</div>
                )}
              </div>
            </div>

            {/* Guia de uso quando vazio */}
            {visitas.length === 0 ? (
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
            ) : (
              <>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">
                  {visitas.length} registro{visitas.length > 1 ? 's' : ''} — clique em um para ver os documentos
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {visitas.map((v, i) => {
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
                          <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-3">
                            <p className="text-sm font-black text-slate-800 truncate">{v.nome_medicamento || 'Medicamento não informado'}</p>
                            <p className="text-xs font-bold text-slate-400 mt-0.5">{currency.format(Number(v.valor || 0))}</p>
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
          <NewRegistroModal client={client} receitaStatus={receitaStatus} onClose={() => setShowNewModal(false)} onAdded={fetchData} />
        )}
        {showRecipeModal && (
          <NewPrescriptionModal client={client} onClose={() => setShowRecipeModal(false)} onAdded={fetchData} />
        )}
        {duplicateSource && (
          <DuplicarModal
            client={client}
            sourceVisita={duplicateSource}
            sourceDocs={docsPerVisita(duplicateSource.id)}
            onClose={() => setDuplicateSource(null)}
            onAdded={fetchData}
          />
        )}
        {modalDoc && <FullscreenViewer url={modalDoc.url} title={modalDoc.title} onClose={() => setModalDoc(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── MODAL: NOVO REGISTRO ────────────────────────────────────────────────────
function NewRegistroModal({ client, receitaStatus, onClose, onAdded }: any) {
  const [medicamento, setMedicamento] = useState('');
  const [valor, setValor] = useState('');
  const [cupomFiles,   setCupomFiles]   = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]     = useState('');

  const addFiles = (setter: React.Dispatch<React.SetStateAction<File[]>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(prev => [...prev, ...Array.from(e.target.files || [])]);
      e.target.value = '';
    };
  const removeFile = (setter: React.Dispatch<React.SetStateAction<File[]>>, i: number) =>
    setter(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receitaStatus) { setError('Cadastre uma receita antes de concluir a compra.'); return; }
    if (receitaStatus.vencida) { setError('Receita vencida. Anexe uma nova receita antes de concluir a compra.'); return; }
    if (cupomFiles.length === 0)   { setError('Anexe pelo menos um Cupom Fiscal.'); return; }

    setLoading(true); setError(''); setStatusMsg('');
    const supabase = getSupabase();
    if (!supabase) return;

    const sizeErrMsg = validateFileSize(cupomFiles[0]);
    if (sizeErrMsg) { setError(sizeErrMsg); setLoading(false); return; }

    try {
      const valorNumerico = Number(valor.replace(',', '.')) || 0;
      const { data: venda, error: vErr } = await supabase.from('vendas')
        .insert([{
          cliente_id: client.id,
          nome_medicamento: medicamento.trim() || 'Não informado',
          valor: valorNumerico,
        }])
        .select().single();
      if (vErr) throw vErr;

      const uploadDocs = async (files: File[], tipo: string) => {
        for (const f of files) {
          setStatusMsg('Comprimindo imagem...');
          const { file: fileToUpload } = await compressImage(f);
          if (fileToUpload !== f) setStatusMsg('Comprimindo imagem...');
          setStatusMsg('Enviando documento...');
          const ext  = fileToUpload.name.split('.').pop();
          const path = `${tipo}/${tipo}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('documentos').upload(path, fileToUpload, {
            contentType: fileToUpload.type,
          });
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from('documentos').getPublicUrl(path);
          await supabase.from('vendas_documentos').insert([{
            venda_id: venda.id, cliente_id: client.id,
            tipo, url: urlData.publicUrl, nome_arquivo: f.name,
          }]);
        }
      };

      await uploadDocs(cupomFiles,   'cupom');
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

            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Dados da compra</p>
                  <p className="text-xs font-semibold text-slate-400">A data e hora serão registradas automaticamente.</p>
                </div>
                <span className="hidden sm:inline-flex px-3 py-1 rounded-full bg-white border border-slate-200 text-[10px] uppercase tracking-widest font-black text-slate-500">Hoje</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-3">
                <div className="space-y-2">
                  <label className="block text-sm font-black text-slate-700">Medicamento</label>
                  <input
                    value={medicamento}
                    onChange={(event) => setMedicamento(event.target.value)}
                    placeholder="Ex: Losartana 50mg"
                    className="w-full px-4 py-3 bg-white border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-slate-800 font-semibold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-black text-slate-700">Valor</label>
                  <input
                    value={valor}
                    inputMode="decimal"
                    onChange={(event) => setValor(event.target.value)}
                    placeholder="0,00"
                    className="w-full px-4 py-3 bg-white border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-slate-800 font-semibold"
                  />
                </div>
              </div>
            </div>

            {receitaStatus ? (
              <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${receitaStatus.vencida ? 'bg-red-50 border-red-100 text-red-700' : 'bg-emerald-50 border-emerald-100 text-emerald-800'}`}>
                {receitaStatus.vencida ? <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-black">{receitaStatus.vencida ? 'Receita vencida' : 'Receita válida para esta compra'}</p>
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
              <UploadBox tipo="cupom" label="Cupom Fiscal" descricao="Foto do cupom da compra"
                files={cupomFiles} onAdd={addFiles(setCupomFiles)} onRemove={(i: number) => removeFile(setCupomFiles, i)}
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
            <button type="submit" disabled={loading}
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

function NewPrescriptionModal({ client, onClose, onAdded }: any) {
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

    setLoading(true);
    setError(''); setStatusMsg('');

    const sizeErr = validateFileSize(file);
    if (sizeErr) { setError(sizeErr); setLoading(false); return; }

    try {
      setStatusMsg('Comprimindo imagem...');
      const { file: fileToUpload } = await compressImage(file);
      setStatusMsg('Enviando documento...');
      const ext = fileToUpload.name.split('.').pop();
      const path = `receita/receita_${client.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documentos').upload(path, fileToUpload, {
        contentType: fileToUpload.type,
      });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('documentos').getPublicUrl(path);
      const { error: insertError } = await supabase.from('vendas_documentos').insert([{
        venda_id: null,
        cliente_id: client.id,
        tipo: 'receita',
        url: urlData.publicUrl,
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
                accept="image/*,application/pdf"
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

// ─── MODAL: DUPLICAR REGISTRO ────────────────────────────────────────────────
function DuplicarModal({ client, sourceVisita, sourceDocs, onClose, onAdded }: any) {
  const sourceReceitas = sourceDocs.filter((d: any) => d.tipo === 'receita');
  const [mesmaReceita, setMesmaReceita] = useState(true);
  const [novaReceitaFiles, setNovaReceitaFiles] = useState<File[]>([]);
  const [cupomFiles, setCupomFiles]             = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]     = useState('');

  const addFiles = (setter: React.Dispatch<React.SetStateAction<File[]>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(prev => [...prev, ...Array.from(e.target.files || [])]);
      e.target.value = '';
    };
  const removeFile = (setter: React.Dispatch<React.SetStateAction<File[]>>, i: number) =>
    setter(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const usaNovaReceita = !mesmaReceita;
    if (usaNovaReceita && novaReceitaFiles.length === 0) { setError('Anexe a nova Receita Médica ou mantenha a anterior.'); return; }
    if (cupomFiles.length === 0) { setError('Anexe o Cupom Fiscal da nova compra.'); return; }

    setLoading(true); setError(''); setStatusMsg('');
    const supabase = getSupabase();
    if (!supabase) return;

    const allFiles = [...novaReceitaFiles, ...cupomFiles];
    let sizeErrMsg: string | null = null;
    for (const f of allFiles) { sizeErrMsg = validateFileSize(f); if (sizeErrMsg) break; }
    if (sizeErrMsg) { setError(sizeErrMsg); setLoading(false); return; }

    try {
      const { data: venda, error: vErr } = await supabase.from('vendas')
        .insert([{
          cliente_id: client.id,
          nome_medicamento: sourceVisita.nome_medicamento || 'Não informado',
          valor: Number(sourceVisita.valor || 0),
        }])
        .select().single();
      if (vErr) throw vErr;

      // Copiar receitas do registro original (reutiliza a mesma URL)
      if (mesmaReceita) {
        for (const doc of sourceReceitas) {
          await supabase.from('vendas_documentos').insert([{
            venda_id: venda.id, cliente_id: client.id,
            tipo: 'receita', url: doc.url, nome_arquivo: doc.nome_arquivo,
          }]);
        }
      } else {
        for (const f of novaReceitaFiles) {
          setStatusMsg('Comprimindo imagem...');
          const { file: fileToUpload } = await compressImage(f);
          setStatusMsg('Enviando documento...');
          const ext  = fileToUpload.name.split('.').pop();
          const path = `receita/receita_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('documentos').upload(path, fileToUpload, {
            contentType: fileToUpload.type,
          });
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from('documentos').getPublicUrl(path);
          await supabase.from('vendas_documentos').insert([{
            venda_id: venda.id, cliente_id: client.id,
            tipo: 'receita', url: urlData.publicUrl, nome_arquivo: f.name,
          }]);
        }
      }

      // Upload cupons novos
      for (const f of cupomFiles) {
        setStatusMsg('Comprimindo imagem...');
        const { file: fileToUpload } = await compressImage(f);
        setStatusMsg('Enviando documento...');
        const ext  = fileToUpload.name.split('.').pop();
        const path = `cupom/cupom_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('documentos').upload(path, fileToUpload, {
          contentType: fileToUpload.type,
        });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('documentos').getPublicUrl(path);
        await supabase.from('vendas_documentos').insert([{
          venda_id: venda.id, cliente_id: client.id,
          tipo: 'cupom', url: urlData.publicUrl, nome_arquivo: f.name,
        }]);
      }

      onAdded(); onClose();
    } catch (err: any) {
      setError(explainSupabaseError(err));
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col max-h-[95vh] overflow-hidden">
        <div className="px-7 pt-7 pb-5 border-b border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Copy size={18} className="text-blue-500" />
                <h2 className="text-xl font-black text-slate-900">Duplicar Registro</h2>
              </div>
              <p className="text-sm text-slate-400">
                Copiando de {format(parseISO(sourceVisita.data_venda || sourceVisita.created_at), "dd/MM/yyyy", { locale: ptBR })} → <strong>hoje, {format(new Date(), "dd/MM/yyyy", { locale: ptBR })}</strong>
              </p>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600 p-1"><X size={22} /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto">
          {statusMsg && <div className="mx-6 mt-5 p-4 bg-blue-50 text-blue-700 rounded-2xl text-sm font-semibold border border-blue-100 flex items-center gap-2"><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />{statusMsg}</div>}
          {error && <div className="mx-6 mt-5 p-4 bg-red-50 text-red-700 rounded-2xl text-sm font-semibold border border-red-100">⚠️ {error}</div>}

          <div className="p-6 space-y-4">
            {/* Receita */}
            <div className="rounded-2xl border-2 border-slate-200 overflow-hidden">
              <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-3">
                <FileText size={18} className="text-blue-600" />
                <p className="font-bold text-sm text-blue-800">Receita Médica</p>
              </div>
              <div className="p-4 space-y-3">
                {/* Toggle */}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMesmaReceita(true)}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${mesmaReceita ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    ✓ Usar a mesma receita
                  </button>
                  <button type="button" onClick={() => setMesmaReceita(false)}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${!mesmaReceita ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    Trocar receita
                  </button>
                </div>

                {mesmaReceita ? (
                  <div className="space-y-1.5">
                    {sourceReceitas.length > 0
                      ? sourceReceitas.map((d: any) => (
                          <div key={d.id} className="flex items-center gap-3 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
                            <div className="w-8 h-8 rounded-lg bg-blue-100 overflow-hidden flex-shrink-0">
                              <img src={d.url} className="w-full h-full object-cover" alt="" />
                            </div>
                            <span className="text-sm text-blue-700 font-medium truncate">{d.nome_arquivo}</span>
                            <CheckCircle2 size={16} className="text-blue-400 flex-shrink-0 ml-auto" />
                          </div>
                        ))
                      : <p className="text-sm text-slate-400 text-center py-2">Nenhuma receita no registro original</p>
                    }
                  </div>
                ) : (
                  <UploadBox tipo="receita" label="Nova Receita" descricao="Selecione o novo arquivo"
                    files={novaReceitaFiles} onAdd={addFiles(setNovaReceitaFiles)}
                    onRemove={(i: number) => removeFile(setNovaReceitaFiles, i)}
                    colorClass="bg-blue-50 text-blue-700" borderClass="border-blue-400" Icon={FileText} obrigatorio />
                )}
              </div>
            </div>

            {/* Cupom (sempre novo) */}
            <UploadBox tipo="cupom" label="2. Novo Cupom Fiscal" descricao="Obrigatório — cupom da nova compra"
              files={cupomFiles} onAdd={addFiles(setCupomFiles)} onRemove={(i: number) => removeFile(setCupomFiles, i)}
              colorClass="bg-indigo-50 text-indigo-700" borderClass="border-indigo-400" Icon={Receipt} obrigatorio />
          </div>

          <div className="px-6 pb-6 flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-4 font-bold text-slate-500 rounded-2xl border-2 border-slate-100 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20">
              {loading
                ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Salvando...</>
                : <><Copy size={18} />Salvar Cópia</>}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
