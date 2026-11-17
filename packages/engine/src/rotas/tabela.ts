import { confere, type Contexto, type Erro, type No, type Registry } from '@polaris/schema'
import { cmpEspecificidade, forma, nomesParams, parseRota, RotaErro, type Segmento } from './padrao'

// ---------------------------------------------------------------------------
// Tabela de rotas de um tenant, compilada a partir dos nós `pagina` e `tenant`. JSON puro.
// Toda validação acontece aqui: ambiguidade, parâmetros, idiomas, redirecionamentos, login, laços.
// ---------------------------------------------------------------------------

export type StatusRedirecionamento = 301 | 302 | 307 | 308

export type EntradaRota = {
  pagina: string
  /** idioma → padrão (sem i18n a chave é ''). */
  padroes: Record<string, Segmento[]>
  /** tipo de cada parâmetro da rota (padrão: texto). */
  params: Record<string, string>
  guarda: string[]
}

export type Redirecionamento = { de: Segmento[]; para: Segmento[]; status: StatusRedirecionamento }

export type TabelaRotas = {
  tenant: string
  /** vazio = sem i18n (sem prefixo de idioma) */
  idiomas: string[]
  idiomaPadrao: string
  entradas: EntradaRota[]
  redirecionamentos: Redirecionamento[]
  rotaLogin?: string
  /** a página que atende a rotaLogin: o redirecionamento usa o roteamento reverso dela (a URL varia por idioma) */
  paginaLogin?: string
  paginaNegado?: string
  paginaNaoEncontrada?: string
}

export type ResultadoTabela = { ok: true; tabela: TabelaRotas } | { ok: false; erros: Erro[] }

type PaginaSpec = { rota: string; rotasI18n?: Record<string, string>; params?: Record<string, { tipo: string }>; guarda?: string[] }
type TenantSpec = {
  paginas?: string[]; idiomas?: string[]; idiomaPadrao?: string; rotaLogin?: string; paginaNegado?: string; paginaNaoEncontrada?: string
  redirecionamentos?: Array<{ de: string; para: string; status?: StatusRedirecionamento }>
}

/** Caminho relativo seguro (sem '//' nem '\\'): único destino de redirecionamento permitido. */
export const caminhoRelativoSeguro = (p: string): boolean => p.startsWith('/') && !p.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(p)

const mesmo = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

export function compilaTabela(reg: Registry, tenant: No, ctx: Contexto = {}): ResultadoTabela {
  if (tenant.kind !== 'tenant') return { ok: false, erros: [{ caminho: '/kind', regra: 'kind', mensagem: `compilaTabela espera kind 'tenant', recebeu '${tenant.kind}'` }] }
  const spec = tenant.spec as TenantSpec
  const erros: Erro[] = [...confere(reg, tenant, ctx)]
  const erro = (caminho: string, regra: string, mensagem: string, dica?: string) => erros.push({ caminho, regra, mensagem, ...(dica ? { dica } : {}) })

  const idiomas = spec.idiomas ?? []
  const idiomaPadrao = idiomas.length ? (spec.idiomaPadrao ?? idiomas[0]!) : ''
  if (idiomas.length && !idiomas.includes(idiomaPadrao)) erro('/spec/idiomaPadrao', 'idioma', `o idioma padrão '${idiomaPadrao}' não está em idiomas`, `idiomas: ${idiomas.join(', ')}`)
  if (!idiomas.length && spec.idiomaPadrao) erro('/spec/idiomaPadrao', 'idioma', 'idiomaPadrao sem idiomas', 'declare idiomas ou remova idiomaPadrao')
  const locais = idiomas.length ? idiomas : ['']

  const entradas: EntradaRota[] = []
  const vistos = new Set<string>()
  const guardaDe = (id: string): string[] => (reg.resolve('pagina', id, ctx)?.no.spec as PaginaSpec | undefined)?.guarda ?? []

  ;(spec.paginas ?? []).forEach((id, i) => {
    const c = `/spec/paginas/${i}`
    if (vistos.has(id)) { erro(c, 'rota', `a página '${id}' aparece duas vezes em paginas`); return }
    vistos.add(id)
    const r = reg.resolve('pagina', id, ctx)
    if (!r) return // a referência quebrada já foi reportada por confere()
    const ps = r.no.spec as PaginaSpec
    const falha = (e: unknown, qual: string): never | undefined => {
      if (e instanceof RotaErro) { erro(c, 'rota', `página '${id}', ${qual}: ${e.message}`, e.dica); return undefined }
      throw e
    }
    let base: Segmento[]
    try { base = parseRota(ps.rota) } catch (e) { falha(e, `rota '${ps.rota}'`); return }
    const nomesBase = nomesParams(base)

    for (const idioma of Object.keys(ps.rotasI18n ?? {})) {
      if (!idiomas.includes(idioma)) erro(c, 'idioma', `página '${id}': rotasI18n usa o idioma '${idioma}', que o tenant não configurou`, idiomas.length ? `idiomas: ${idiomas.join(', ')}` : 'declare idiomas no tenant')
    }
    const padroes: Record<string, Segmento[]> = {}
    for (const idioma of locais) {
      const texto = ps.rotasI18n?.[idioma]
      if (texto === undefined) { padroes[idioma] = base; continue }
      try {
        const segs = parseRota(texto)
        if (!mesmo(nomesParams(segs), nomesBase)) erro(c, 'rota', `página '${id}': a rota de '${idioma}' tem parâmetros (${nomesParams(segs).join(', ') || 'nenhum'}) diferentes da rota base (${nomesBase.join(', ') || 'nenhum'})`)
        padroes[idioma] = segs
      } catch (e) { falha(e, `rota '${texto}' em '${idioma}'`); padroes[idioma] = base }
    }

    const params: Record<string, string> = {}
    for (const n of nomesBase) params[n] = ps.params?.[n]?.tipo ?? 'texto'
    for (const n of Object.keys(ps.params ?? {})) {
      if (!nomesBase.includes(n)) erro(c, 'rota', `página '${id}': o parâmetro '${n}' está declarado em params mas não aparece na rota '${ps.rota}'`, nomesBase.length ? `parâmetros da rota: ${nomesBase.join(', ')}` : 'a rota não tem parâmetros')
    }
    entradas.push({ pagina: id, padroes, params, guarda: [...(ps.guarda ?? [])] })
  })

  // ambiguidade: mesma forma no mesmo idioma
  for (const idioma of locais) {
    const porForma = new Map<string, string>()
    for (const e of entradas) {
      const f = forma(e.padroes[idioma]!)
      const outro = porForma.get(f)
      if (outro) erro('/spec/paginas', 'rota-ambigua', `as páginas '${outro}' e '${e.pagina}' têm a mesma rota${idioma ? ` em '${idioma}'` : ''}: ${f === '/' ? '/' : f.replace(/e:/g, '').replace(/:/g, ':param')}`, 'mude uma das rotas')
      else porForma.set(f, e.pagina)
    }
  }
  // com i18n, o primeiro segmento estático não pode ser um código de idioma (colidiria com o prefixo)
  if (idiomas.length) {
    const minus = new Set(idiomas.map((x) => x.toLowerCase()))
    for (const e of entradas) for (const [idioma, segs] of Object.entries(e.padroes)) {
      const p = segs[0]
      if (p?.t === 'est' && minus.has(p.v.toLowerCase())) erro('/spec/paginas', 'rota', `a página '${e.pagina}' usa '${p.v}' como primeiro segmento em '${idioma}', mas é um código de idioma (prefixo de URL)`, 'renomeie o segmento')
    }
  }

  let paginaLogin: string | undefined
  const redirecionamentos: Redirecionamento[] = []
  ;(spec.redirecionamentos ?? []).forEach((r, i) => {
    const c = `/spec/redirecionamentos/${i}`
    let de: Segmento[], para: Segmento[]
    try { de = parseRota(r.de) } catch (e) { if (e instanceof RotaErro) { erro(`${c}/de`, 'redirecionamento', `'de' '${r.de}': ${e.message}`, e.dica); return } throw e }
    try { para = parseRota(r.para) } catch (e) { if (e instanceof RotaErro) { erro(`${c}/para`, 'redirecionamento', `'para' '${r.para}': ${e.message}`, e.dica); return } throw e }
    if (!caminhoRelativoSeguro(r.para)) { erro(`${c}/para`, 'redirecionamento', `'para' precisa ser um caminho relativo do próprio site`, 'redirecionar para outro domínio não é permitido (open redirect)'); return }
    const nomesDe = nomesParams(de)
    for (const n of nomesParams(para)) if (!nomesDe.includes(n)) erro(`${c}/para`, 'redirecionamento', `'para' usa :${n}, que não existe em 'de' (${r.de})`, nomesDe.length ? `parâmetros de 'de': ${nomesDe.join(', ')}` : "'de' não tem parâmetros")
    if (redirecionamentos.some((o) => forma(o.de) === forma(de))) erro(`${c}/de`, 'redirecionamento', `já existe um redirecionamento para '${r.de}'`)
    redirecionamentos.push({ de, para, status: r.status ?? 301 })
  })
  // laços: segue a cadeia com valores fictícios
  redirecionamentos.forEach((r, i) => {
    const visitados = new Set<number>([i])
    let atual = r
    for (let passo = 0; passo < 12; passo++) {
      const alvo = montaAlvoFicticio(atual.para)
      const prox = redirecionamentos.findIndex((o) => casaFicticio(o.de, alvo))
      if (prox === -1) return
      if (visitados.has(prox)) { erro(`/spec/redirecionamentos/${i}`, 'redirecionamento', 'redirecionamentos em laço (A → B → A)', 'quebre o ciclo'); return }
      visitados.add(prox)
      atual = redirecionamentos[prox]!
    }
    erro(`/spec/redirecionamentos/${i}`, 'redirecionamento', 'cadeia de redirecionamentos longa demais (mais de 12)')
  })

  // login e páginas de erro: nenhuma pode exigir permissão (senão o próprio redirecionamento/negação entra em laço)
  if (spec.rotaLogin !== undefined) {
    try {
      const segs = parseRota(spec.rotaLogin)
      if (nomesParams(segs).length) erro('/spec/rotaLogin', 'login', 'rotaLogin não pode ter parâmetros')
      const e = entradas.find((x) => casaFicticio(x.padroes[idiomaPadrao]!, segs.map((s) => (s.t === 'est' ? s.v : 'x'))))
      if (!e) erro('/spec/rotaLogin', 'login', `nenhuma página do tenant atende a rotaLogin '${spec.rotaLogin}'`, 'inclua a página de login em paginas')
      else if (e.guarda.length) erro('/spec/rotaLogin', 'login', `a página de login '${e.pagina}' exige permissões: o usuário sem sessão nunca a abriria (laço)`, 'remova guarda da página de login')
      else paginaLogin = e.pagina
    } catch (e) { if (e instanceof RotaErro) erro('/spec/rotaLogin', 'login', e.message, e.dica); else throw e }
  }
  for (const k of ['paginaNegado', 'paginaNaoEncontrada'] as const) {
    const id = spec[k]
    if (id && guardaDe(id).length) erro(`/spec/${k}`, 'login', `a página '${id}' exige permissões, mas é a página de ${k === 'paginaNegado' ? 'acesso negado' : 'não encontrado'}: causaria laço`, 'remova guarda dela')
  }

  if (erros.length) return { ok: false, erros }
  entradas.sort((a, b) => cmpEspecificidade(a.padroes[idiomaPadrao]!, b.padroes[idiomaPadrao]!) || a.pagina.localeCompare(b.pagina))
  return {
    ok: true,
    tabela: {
      tenant: tenant.id, idiomas, idiomaPadrao, entradas, redirecionamentos,
      ...(spec.rotaLogin ? { rotaLogin: spec.rotaLogin } : {}),
      ...(paginaLogin ? { paginaLogin } : {}),
      ...(spec.paginaNegado ? { paginaNegado: spec.paginaNegado } : {}),
      ...(spec.paginaNaoEncontrada ? { paginaNaoEncontrada: spec.paginaNaoEncontrada } : {}),
    },
  }
}

/** Segmentos de um alvo com valores fictícios, para detectar laços de redirecionamento. */
function montaAlvoFicticio(segs: readonly Segmento[]): string[] {
  return segs.flatMap((s) => (s.t === 'est' ? [s.v] : s.t === 'par' ? ['x'] : ['x']))
}

function casaFicticio(padrao: readonly Segmento[], partes: string[]): boolean {
  let i = 0
  for (const s of padrao) {
    if (s.t === 'resto') return i < partes.length
    if (i >= partes.length) return false
    if (s.t === 'est' && s.v !== partes[i]) return false
    i++
  }
  return i === partes.length
}
