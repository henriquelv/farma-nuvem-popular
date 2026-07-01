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
  const totalValue = sales.reduce((acc, curr) => acc + Number(curr.valor), 0);
  const avgValue = totalSales > 0 ? totalValue / totalSales : 0;

  doc.text(`Total de Vendas: ${totalSales}`, 14, 38);
  doc.text(`Valor Total: R$ ${totalValue.toFixed(2).replace('.', ',')}`, 14, 44);
  doc.text(`Ticket Médio: R$ ${avgValue.toFixed(2).replace('.', ',')}`, 14, 50);

  const tableData = sales.map(s => [
    format(new Date(s.data_venda), 'dd/MM/yyyy HH:mm'),
    s.clientes?.nome_completo || 'N/A',
    s.clientes?.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") || 'N/A',
    s.nome_medicamento,
    `R$ ${Number(s.valor).toFixed(2).replace('.', ',')}`
  ]);

  autoTable(doc, {
    startY: 58,
    head: [['Data', 'Cliente', 'CPF', 'Medicamento', 'Valor']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235] }
  });

  doc.save(`relatorio-auditoria-${Date.now()}.pdf`);
};
