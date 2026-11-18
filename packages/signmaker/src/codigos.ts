import { DocumentoErro } from '@polaris/documentos'
import JsBarcode from 'jsbarcode'
import qrcode from 'qrcode-generator'

/** os módulos (1 = barra, 0 = espaço) de um código de barras; erro claro quando o valor não é válido para o formato (nunca desenha código que não lê) */
export function modulosBarras(valor: string, formato: 'code128' | 'ean13'): string {
  if (!valor) throw new DocumentoErro('código de barras sem valor')
  if (valor.length > 80) throw new DocumentoErro('código de barras com mais de 80 caracteres')
  const saida: { encodings?: Array<{ data: string }> } = {}
  try { JsBarcode(saida, valor, { format: formato === 'ean13' ? 'EAN13' : 'CODE128' }) } catch { throw new DocumentoErro(`"${valor.slice(0, 20)}" não é um valor válido para ${formato === 'ean13' ? 'EAN-13 (12 dígitos, ou 13 com dígito verificador correto)' : 'Code 128'}`) }
  const bits = (saida.encodings ?? []).map((e) => e.data).join('')
  if (!/^[01]+$/.test(bits)) throw new DocumentoErro('o gerador de código de barras não devolveu módulos')
  return bits
}

/** a matriz de módulos de um QR code (true = escuro) */
export function matrizQr(valor: string, nivel: 'L' | 'M' | 'Q' | 'H'): boolean[][] {
  if (!valor) throw new DocumentoErro('QR code sem valor')
  if (valor.length > 1000) throw new DocumentoErro('QR code com mais de 1000 caracteres')
  const q = qrcode(0, nivel)
  try { q.addData(valor); q.make() } catch { throw new DocumentoErro('o valor não cabe em um QR code') }
  const n = q.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)))
}

/** sequências horizontais de módulos escuros: [coluna, comprimento] por linha (menos retângulos do que um por módulo) */
export const corridas = (linha: ReadonlyArray<boolean | number | string>): Array<[number, number]> => {
  const out: Array<[number, number]> = []; let i = 0
  while (i < linha.length) { if (linha[i] === true || linha[i] === '1' || linha[i] === 1) { let j = i; while (j < linha.length && (linha[j] === true || linha[j] === '1' || linha[j] === 1)) j++; out.push([i, j - i]); i = j } else i++ }
  return out
}
