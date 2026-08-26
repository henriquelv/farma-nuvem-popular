import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

export const generateAuditPDF = (sales: any[], startDate: string, endDate: string) => {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text('Relatório de Auditoria - Farmácia Popular', 14, 22);

  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Período: ${startDate || 'Início'} a ${endDate || 'Hoje'}`, 14, 30);

  const totalSales = sales.length;
  doc.text(`Total de registros: ${totalSales}`, 14, 38);

  const tableData = sales.map(s => [
    format(new Date(s.data_venda), 'dd/MM/yyyy HH:mm'),
    s.clientes?.nome_completo || 'N/A',
    s.clientes?.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") || 'N/A'
  ]);

  autoTable(doc, {
    startY: 46,
    head: [['Data', 'Cliente', 'CPF']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235] }
  });

  doc.save(`relatorio-auditoria-${Date.now()}.pdf`);
};
