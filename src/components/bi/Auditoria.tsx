import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Search, FileText, Receipt, Filter, Download, Maximize2, X, ZoomIn, ZoomOut, Printer, BarChart3, Users } from 'lucide-react';
import { getSupabase } from '../../lib/supabase';
import { maskDate, parseDateToDB } from '../../lib/validators';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDateBR, getDocumentName, isPdfDocument, parsePrescriptionMeta } from '../../lib/documents';

function FullscreenViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const isPdf = isPdfDocument(url, title);

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><body style="margin:0;background:#fff;"><${isPdf ? 'iframe' : 'img'} src="${url}" style="width:100%;height:100%;border:0;object-fit:contain;"></${isPdf ? 'iframe' : 'img'}></body></html>`);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); win.close(); }, 500);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${title.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) { console.error('Download falhou:', err); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/95 z-[100] flex flex-col pt-16"
    >
      <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-10 bg-black/40 backdrop-blur-md border-b border-white/5">
        <h3 className="text-white font-black uppercase text-sm tracking-widest px-4">{title}</h3>
        <div className="flex items-center gap-2 pr-4">
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="p-2 text-white/70 hover:text-white transition-colors"><ZoomOut size={22} /></button>
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="p-2 text-white/70 hover:text-white transition-colors"><ZoomIn size={22} /></button>
          <button onClick={handlePrint} className="p-2 text-white/70 hover:text-white transition-colors ml-4"><Printer size={22} /></button>
          <button onClick={handleDownload} className="p-2 text-white/70 hover:text-white transition-colors"><Download size={22} /></button>
          <button onClick={onClose} className="p-2 bg-red-500 text-white rounded-full ml-6 transition-transform hover:scale-110"><X size={20} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8 bg-slate-100">
        {isPdf ? (
          <iframe src={url} title={title} className="w-full h-full bg-white rounded-xl shadow-2xl border border-slate-200" />
        ) : (
          <motion.img
            src={url} alt={title}
            style={{ scale: zoom }}
            className="max-h-full max-w-full shadow-2xl rounded-xl bg-white transition-transform duration-200"
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: zoom, opacity: 1 }}
          />
        )}
      </div>
    </motion.div>
  );
}

export default function Auditoria() {
  const navigate = useNavigate();
  const [searchClient, setSearchClient] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterTipo, setFilterTipo] = useState<'todos' | 'receita' | 'cupom'>('todos');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [modalDoc, setModalDoc] = useState<{ url: string; title: string } | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;

    setLoading(true);
    try {
      let query = supabase
        .from('vendas_documentos')
        .select('*, clientes(nome_completo, cpf)')
        .order('created_at', { ascending: false });

      if (filterTipo !== 'todos') {
        query = query.eq('tipo', filterTipo);
      }

      if (startDate && startDate.length === 10) {
        const startDb = parseDateToDB(startDate);
        if (startDb) {
          const start = new Date(startDb);
          start.setHours(0, 0, 0, 0);
          query = query.gte('created_at', start.toISOString());
        }
      }

      if (endDate && endDate.length === 10) {
        const endDb = parseDateToDB(endDate);
        if (endDb) {
          const end = new Date(endDb);
          end.setHours(23, 59, 59, 999);
          query = query.lte('created_at', end.toISOString());
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      let filtered = data || [];

      if (searchClient.trim()) {
        const termLower = searchClient.toLowerCase();
        const termDigits = searchClient.replace(/\D/g, '');
        filtered = filtered.filter(d => {
          const nome = (d.clientes?.nome_completo || '').toLowerCase();
          const cpf = d.clientes?.cpf || '';
          return nome.includes(termLower) || (termDigits && cpf.includes(termDigits));
        });
      }

      setResults(filtered);
      setSearched(true);
    } catch (err) {
      console.error('Erro na busca de auditoria:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Relatório de Auditoria — Farmácia Popular', 14, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    const periodoTexto = startDate && endDate
      ? `Período: ${startDate} a ${endDate}`
      : startDate ? `A partir de: ${startDate}`
      : endDate ? `Até: ${endDate}`
      : 'Período: Todos os registros';
    doc.text(periodoTexto, 14, 28);
    if (searchClient) doc.text(`Cliente: ${searchClient}`, 14, 34);
    if (filterTipo !== 'todos') doc.text(`Tipo: ${filterTipo === 'receita' ? 'Receitas' : 'Cupons Fiscais'}`, 14, 40);

    const totalCupons = results.filter(r => r.tipo === 'cupom').length;
    const totalReceitas = results.filter(r => r.tipo === 'receita').length;
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total de documentos: ${results.length}  |  Cupons: ${totalCupons}  |  Receitas: ${totalReceitas}`, 14, 50);

    const tableData = results.map(r => [
      r.clientes?.nome_completo || 'N/A',
      r.clientes?.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') || 'N/A',
      r.tipo === 'cupom' ? 'Cupom Fiscal' : 'Receita',
      r.tipo === 'receita'
        ? `${getDocumentName(r)} (${formatDateBR(parsePrescriptionMeta(r).inicio)} a ${formatDateBR(parsePrescriptionMeta(r).vencimento)})`
        : getDocumentName(r),
      new Date(r.created_at).toLocaleDateString('pt-BR'),
    ]);

    autoTable(doc, {
      startY: 56,
      head: [['Cliente', 'CPF', 'Tipo', 'Documento', 'Data']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 8 },
    });

    doc.save(`auditoria-${Date.now()}.pdf`);
  };

  const totalCupons = results.filter(r => r.tipo === 'cupom').length;
  const totalReceitas = results.filter(r => r.tipo === 'receita').length;

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
          <div className="bg-emerald-600 text-white p-2 rounded-xl shadow-lg shadow-emerald-600/20">
            <ShieldCheck size={28} />
          </div>
          Auditoria de Documentos
        </h1>
        <p className="text-slate-500 mt-2 text-lg">Consulte cupons fiscais e receitas por período e cliente.</p>
      </div>

      {/* Filtros */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
        <form onSubmit={handleSearch} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Busca por cliente */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Cliente (nome ou CPF)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                  <Users size={18} />
                </div>
                <input
                  type="text"
                  value={searchClient}
                  onChange={e => setSearchClient(e.target.value)}
                  placeholder="Ex: João Silva ou 123.456.789-00"
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-slate-700 font-medium"
                />
              </div>
            </div>

            {/* Tipo de documento */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Tipo de Documento</label>
              <div className="flex gap-2">
                {(['todos', 'cupom', 'receita'] as const).map(tipo => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setFilterTipo(tipo)}
                    className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                      filterTipo === tipo
                        ? tipo === 'cupom' ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg'
                          : tipo === 'receita' ? 'bg-blue-600 border-blue-600 text-white shadow-lg'
                          : 'bg-slate-900 border-slate-900 text-white shadow-lg'
                        : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                    }`}
                  >
                    {tipo === 'todos' ? 'Todos' : tipo === 'cupom' ? 'Cupons' : 'Receitas'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Período */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 flex items-center gap-2">
              <Filter size={12} /> Período (ex: de 01/01/2020 a 31/12/2025)
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={startDate}
                onChange={e => setStartDate(maskDate(e.target.value))}
                maxLength={10}
                placeholder="De (DD/MM/AAAA)"
                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-bold"
              />
              <input
                type="text"
                value={endDate}
                onChange={e => setEndDate(maskDate(e.target.value))}
                maxLength={10}
                placeholder="Até (DD/MM/AAAA)"
                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-bold"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setSearchClient(''); setStartDate(''); setEndDate(''); setFilterTipo('todos'); setResults([]); setSearched(false); }}
              className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest hover:text-slate-600 transition-colors"
            >
              Limpar
            </button>
            <button
              type="submit"
              className="px-10 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-emerald-600/20 transition-colors"
            >
              Buscar Documentos
            </button>
          </div>
        </form>
      </div>

      {/* Resultados */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
        </div>
      ) : searched && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Contadores */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
              <div className="p-3 bg-slate-100 rounded-xl"><BarChart3 size={22} className="text-slate-600" /></div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total de Documentos</p>
                <p className="text-3xl font-black text-slate-900">{results.length}</p>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
              <div className="p-3 bg-indigo-50 rounded-xl"><Receipt size={22} className="text-indigo-600" /></div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cupons Fiscais</p>
                <p className="text-3xl font-black text-indigo-700">{totalCupons}</p>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl"><FileText size={22} className="text-blue-600" /></div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Receitas Médicas</p>
                <p className="text-3xl font-black text-blue-700">{totalReceitas}</p>
              </div>
            </div>
          </div>

          {results.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-slate-900/20 hover:-translate-y-0.5 transition-all"
              >
                <Download size={16} /> Exportar PDF
              </button>
            </div>
          )}

          {/* Tabela */}
          {results.length > 0 ? (
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="pb-4 pt-5 pl-6">Cliente</th>
                      <th className="pb-4 pt-5">CPF</th>
                      <th className="pb-4 pt-5">Tipo</th>
                      <th className="pb-4 pt-5">Documento</th>
                      <th className="pb-4 pt-5">Data</th>
                      <th className="pb-4 pt-5 pr-6 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {results.map((doc, i) => (
                      <motion.tr
                        key={doc.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="hover:bg-slate-50 transition-colors group"
                      >
                        <td className="py-4 pl-6">
                          <span className="font-bold text-slate-800 text-sm">{doc.clientes?.nome_completo || '—'}</span>
                        </td>
                        <td className="py-4 text-slate-500 font-mono text-sm">
                          {doc.clientes?.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') || '—'}
                        </td>
                        <td className="py-4">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                            doc.tipo === 'cupom'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}>
                            {doc.tipo === 'cupom' ? <Receipt size={10} /> : <FileText size={10} />}
                            {doc.tipo === 'cupom' ? 'Cupom Fiscal' : 'Receita'}
                          </span>
                        </td>
                        <td className="py-4 text-slate-700 text-sm font-medium max-w-[220px] truncate">
                          {doc.tipo === 'receita'
                            ? `${getDocumentName(doc)} · ${formatDateBR(parsePrescriptionMeta(doc).inicio)} a ${formatDateBR(parsePrescriptionMeta(doc).vencimento)}`
                            : getDocumentName(doc)}
                        </td>
                        <td className="py-4 text-slate-500 text-sm font-medium">
                          {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="py-4 pr-6 text-right">
                          <button
                            onClick={() => setModalDoc({ url: doc.url, title: getDocumentName(doc) })}
                            className="flex items-center gap-2 ml-auto text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl transition-colors text-[10px] font-black uppercase tracking-wide"
                          >
                            <Maximize2 size={14} /> Visualizar
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center bg-white rounded-3xl shadow-sm border border-slate-100 border-dashed">
              <ShieldCheck size={48} className="mx-auto mb-4 text-slate-300" />
              <p className="text-xl font-bold text-slate-700">Nenhum documento encontrado</p>
              <p className="text-base mt-2 text-slate-400">Tente ajustar os filtros da busca.</p>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {modalDoc && <FullscreenViewer url={modalDoc.url} title={modalDoc.title} onClose={() => setModalDoc(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}
