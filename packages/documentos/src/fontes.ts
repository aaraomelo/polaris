import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import opentype, { type Font } from 'opentype.js'
import type { Peso } from './modelo'

// As MESMAS TTF medem o texto no layout, vão embarcadas no PDF e são referenciadas no HTML: é isso que dá a paridade. Só TTF (WOFF/WOFF2 corrompe no fontkit).
type Entrada = { familia: string; normal: string; negrito: string }
const dir = (f: string) => fileURLToPath(new URL(`../fontes/${f}`, import.meta.url))
export const FONTES: Record<string, Entrada> = { Roboto: { familia: 'Roboto', normal: dir('Roboto-Regular.ttf'), negrito: dir('Roboto-Bold.ttf') } }
export const FONTE_PADRAO = 'Roboto'

const bytes = new Map<string, Buffer>(), analisadas = new Map<string, Font>()
export function bytesDe(familia: string, peso: Peso): Buffer {
  const e = FONTES[familia]; if (!e) throw new Error(`fonte desconhecida: ${familia} (disponíveis: ${Object.keys(FONTES).join(', ')})`)
  const arq = e[peso]; let b = bytes.get(arq); if (!b) { b = readFileSync(arq); bytes.set(arq, b) }; return b
}
export function fonteDe(familia: string, peso: Peso): Font {
  const k = `${familia}:${peso}`; let f = analisadas.get(k)
  if (!f) { const b = bytesDe(familia, peso); f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); analisadas.set(k, f) }
  return f
}
