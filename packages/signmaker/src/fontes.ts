import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FONTES as FONTES_DOCUMENTOS } from '@polaris/documentos'
import opentype, { type Font } from 'opentype.js'
import type { Peso } from './modelo'

// As MESMAS TTF medem o texto no layout, vão embarcadas no PDF e são referenciadas no HTML. Só TTF.
type Entrada = { familia: string; normal: string; negrito: string }
const dir = (f: string) => fileURLToPath(new URL(`../fontes/${f}`, import.meta.url))
export const FONTES: Record<string, Entrada> = {
  Montserrat: { familia: 'Montserrat', normal: dir('Montserrat-Regular.ttf'), negrito: dir('Montserrat-Bold.ttf') },
  Roboto: FONTES_DOCUMENTOS.Roboto!,
}
export const FONTE_PADRAO = 'Montserrat'

const bytes = new Map<string, Buffer>(), analisadas = new Map<string, Font>()
export function bytesDe(familia: string, peso: Peso): Buffer {
  if (!Object.hasOwn(FONTES, familia)) throw new Error(`fonte desconhecida: ${familia} (disponíveis: ${Object.keys(FONTES).join(', ')})`)
  const arq = FONTES[familia]![peso]; let b = bytes.get(arq); if (!b) { b = readFileSync(arq); bytes.set(arq, b) }; return b
}
export function fonteDe(familia: string, peso: Peso): Font {
  const k = `${familia}:${peso}`; let f = analisadas.get(k)
  if (!f) { const b = bytesDe(familia, peso); f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); analisadas.set(k, f) }
  return f
}
