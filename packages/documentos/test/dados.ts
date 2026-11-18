import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const nos = (pack: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../packs/nos/${pack}/documentos.json`, import.meta.url)), 'utf8')) as Array<{ kind: 'documento'; id: string; spec: Record<string, any> }>
export const NO_OS = nos('servicos')[0]!, NO_PEDIDO = nos('vendas')[0]!, NO_RECIBO = nos('pagamentos')[0]!
export const empresa = { nome: 'Oficina Estrela do Norte Ltda', cnpj: '12345678000195', telefone: '(11) 4002-8922' }
export const DADOS_OS = {
  empresa, cliente: { nome: 'Maria da Conceição Álvares', documento: '12345678909', telefone: '(11) 99999-0000' },
  os: { numero: 'OS-000123', abertaEm: '2026-06-08', status: 'em andamento', garantiaAte: '2026-09-08', objeto: 'Notebook Lenovo ThinkPad T14 — série PF2ABCDE', descricao: 'Não liga após queda de líquido no teclado. Cliente relata cheiro de queimado.', diagnostico: 'Placa-mãe com corrosão na região do conector da bateria.' },
  itens: [{ descricao: 'Limpeza química da placa', tipo: 'servico', quantidade: '1', precoUnitario: '180.00', total: '180.00' }, { descricao: 'Conector da bateria', tipo: 'peca', quantidade: '1', precoUnitario: '49.90', total: '49.90' }, { descricao: 'Pasta térmica', tipo: 'peca', quantidade: '2', precoUnitario: '12.5', total: '25.00' }],
  totais: { servicos: '180.00', pecas: '74.90', desconto: '0', total: '254.90' },
}
export const DADOS_PEDIDO = {
  empresa, cliente: { nome: 'João Pedro', documento: '98765432100' },
  pedido: { numero: 'P-9001', criadoEm: '2026-06-08T14:30:00Z', metodoPagamento: 'pix', status: 'confirmado' },
  itens: Array.from({ length: 3 }, (_, i) => ({ nome: `Camiseta básica ${i + 1}`, variante: 'M · Azul', quantidade: '2', precoUnitario: '59.90', totalLinha: '119.80' })),
  totais: { subtotal: '359.40', frete: '15.00', desconto: '10.00', total: '364.40' },
}
export const DADOS_RECIBO = { empresa, pagador: { nome: 'Maria da Conceição Álvares', documento: '12345678909' }, pagamento: { numero: 'R-77', pagoEm: '2026-06-08T17:05:00-03:00', valor: '254.90', taxa: '3.82', liquido: '251.08', metodo: 'PIX', referencia: 'a ordem de serviço OS-000123' } }
