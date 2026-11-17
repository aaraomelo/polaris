import { confereValor } from '../dados/args'
import { montaCaminho, nomesParams, valorSeguro, type Segmento } from './padrao'
import type { EntradaRota, TabelaRotas } from './tabela'

export type ResultadoUrl = { ok: true; url: string } | { ok: false; erro: string }

/** Padrão da entrada para o idioma (com fallback para o padrão do tenant). */
export function padraoDe(t: TabelaRotas, e: EntradaRota, idioma: string): Segmento[] {
  return e.padroes[t.idiomas.length ? idioma : ''] ?? e.padroes[t.idiomaPadrao] ?? Object.values(e.padroes)[0]!
}

/** Prefixo de idioma: só quando há i18n e o idioma não é o padrão. */
export const prefixoDe = (t: TabelaRotas, idioma: string): string => (t.idiomas.length && idioma !== t.idiomaPadrao ? `/${idioma}` : '')

/** Valida e normaliza os valores dos parâmetros de uma rota. Simétrico a resolveRota: o que urlDe aceita, resolveRota resolve de volta. */
export function validaParams(e: EntradaRota, padrao: readonly Segmento[], params: Record<string, unknown>): { ok: true; valores: Record<string, string | string[]>; tipados: Record<string, unknown> } | { ok: false; erro: string } {
  const nomes = nomesParams(padrao)
  for (const k of Object.keys(params)) if (!nomes.includes(k)) return { ok: false, erro: `o parâmetro '${k}' não existe na rota (parâmetros: ${nomes.join(', ') || 'nenhum'})` }
  const valores: Record<string, string | string[]> = {}
  const tipados: Record<string, unknown> = {}
  for (const s of padrao) {
    if (s.t === 'est') continue
    const v = params[s.nome]
    if (v === undefined || v === null) return { ok: false, erro: `falta o parâmetro '${s.nome}'` }
    if (s.t === 'resto') {
      if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || !valorSeguro(x))) return { ok: false, erro: `o parâmetro '${s.nome}' deve ser uma lista não vazia de segmentos seguros` }
      valores[s.nome] = v as string[]; tipados[s.nome] = v
      continue
    }
    const r = confereValor({ tipo: e.params[s.nome] ?? 'texto' }, v)
    if (!r.ok) return { ok: false, erro: `o parâmetro '${s.nome}' deveria ser ${r.esperado}` }
    const texto = String(r.valor)
    if (!valorSeguro(texto)) return { ok: false, erro: `o valor do parâmetro '${s.nome}' não pode ser vazio, '.', '..', nem conter '/', '\\' ou caracteres de controle` }
    valores[s.nome] = texto; tipados[s.nome] = r.valor
  }
  return { ok: true, valores, tipados }
}

/** Roteamento reverso: a URL de uma página para um idioma, com os parâmetros codificados. */
export function urlDe(t: TabelaRotas, pagina: string, params: Record<string, unknown> = {}, opcoes: { idioma?: string; consulta?: Record<string, string | number | boolean> } = {}): ResultadoUrl {
  const e = t.entradas.find((x) => x.pagina === pagina)
  if (!e) return { ok: false, erro: `página '${pagina}' não está na tabela de rotas` }
  const idioma = opcoes.idioma ?? t.idiomaPadrao
  if (t.idiomas.length && !t.idiomas.includes(idioma)) return { ok: false, erro: `idioma '${idioma}' não configurado (idiomas: ${t.idiomas.join(', ')})` }
  const padrao = padraoDe(t, e, idioma)
  const v = validaParams(e, padrao, params)
  if (!v.ok) return v
  const caminho = montaCaminho(padrao, v.valores)
  const prefixo = prefixoDe(t, idioma)
  const base = prefixo ? (caminho === '/' ? prefixo : prefixo + caminho) : caminho
  const q = opcoes.consulta ? new URLSearchParams(Object.keys(opcoes.consulta).sort().map((k) => [k, String(opcoes.consulta![k])])).toString() : ''
  return { ok: true, url: q ? `${base}?${q}` : base }
}
