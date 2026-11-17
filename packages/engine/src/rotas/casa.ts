import { confereValor } from '../dados/args'
import { cmpEspecificidade, montaCaminho, nomesParams, valorSeguro, type Segmento } from './padrao'
import { caminhoRelativoSeguro, type StatusRedirecionamento, type TabelaRotas } from './tabela'
import { padraoDe, prefixoDe, urlDe } from './url'

// ---------------------------------------------------------------------------
// Resolução de uma requisição para: página, redirecionamento, acesso negado, 404 ou pedido inválido.
// Pura e síncrona: recebe o caminho (pathname), a query bruta e a sessão; devolve o que fazer.
// ---------------------------------------------------------------------------

export type Pedido = {
  /** apenas o pathname, como veio na requisição (ainda codificado) */
  caminho: string
  /** query string bruta, sem o '?' */
  consulta?: string
  /** null/ausente = sem sessão */
  sessao?: { permissoes: readonly string[] } | null
}

export type ResultadoRota =
  | { tipo: 'pagina'; status: 200; pagina: string; params: Record<string, unknown>; idioma: string; canonica: string; alternativas: Record<string, string> }
  | { tipo: 'redireciona'; status: StatusRedirecionamento; para: string; motivo: 'barra' | 'idioma' | 'redirecionamento' | 'login' }
  | { tipo: 'negado'; status: 401 | 403; pagina?: string }
  | { tipo: 'nao-encontrada'; status: 404; pagina?: string }
  | { tipo: 'invalida'; status: 400; motivo: string }

const CONTROLE = /[\u0000-\u001f\u007f]/
const MAX_CAMINHO = 2048
const MAX_CONSULTA = 4096
const MAX_SEGMENTOS_REQ = 32

const invalida = (motivo: string): ResultadoRota => ({ tipo: 'invalida', status: 400, motivo })

/** Casa os segmentos já decodificados com um padrão. Valores de parâmetro inseguros não casam. */
export function casaSegmentos(padrao: readonly Segmento[], partes: readonly string[]): { valores: Record<string, string | string[]> } | null {
  const valores: Record<string, string | string[]> = {}
  let i = 0
  for (const s of padrao) {
    if (s.t === 'resto') {
      const sobra = partes.slice(i)
      if (!sobra.length || !sobra.every(valorSeguro)) return null
      valores[s.nome] = [...sobra]
      return { valores }
    }
    const p = partes[i]
    if (p === undefined) return null
    if (s.t === 'est') { if (s.v !== p) return null }
    else { if (!valorSeguro(p)) return null; valores[s.nome] = p }
    i++
  }
  return i === partes.length ? { valores } : null
}

/** Valida o destino pós-login (`?volta=`): só caminho relativo do próprio site; qualquer outra coisa vira '/'. */
export function voltaSegura(valor: string | null | undefined): string {
  return typeof valor === 'string' && valor.length <= MAX_CAMINHO && caminhoRelativoSeguro(valor) ? valor : '/'
}

export function resolveRota(t: TabelaRotas, pedido: Pedido): ResultadoRota {
  const raw = pedido.caminho
  const q = pedido.consulta ?? ''
  if (typeof raw !== 'string' || !raw.startsWith('/')) return invalida("o caminho deve começar com '/'")
  if (raw.length > MAX_CAMINHO) return invalida('caminho longo demais')
  if (/[\\?#]/.test(raw) || CONTROLE.test(raw)) return invalida('caminho com caracteres inválidos')
  if (q.length > MAX_CONSULTA || CONTROLE.test(q)) return invalida('query inválida') // CR/LF na query viraria injeção de cabeçalho no Location
  const brutos = raw.split('/').slice(1)
  if (brutos.some((s) => s === '.' || s === '..')) return invalida("segmentos '.' e '..' não são permitidos")
  const partes = brutos.filter((s) => s !== '')
  if (partes.length > MAX_SEGMENTOS_REQ) return invalida('caminho com segmentos demais')
  const sufixoQ = q ? `?${q}` : ''
  const normalizado = '/' + partes.join('/')
  if (normalizado !== raw) return { tipo: 'redireciona', status: 308, para: normalizado + sufixoQ, motivo: 'barra' }

  let dec: string[]
  try { dec = partes.map((p) => decodeURIComponent(p)) } catch { return invalida('codificação percentual malformada') }
  if (dec.some((s) => CONTROLE.test(s))) return invalida('segmento com caracteres de controle')

  // redirecionamentos do tenant vêm primeiro e casam com o caminho completo (inclusive prefixo de idioma)
  for (const r of t.redirecionamentos) {
    const m = casaSegmentos(r.de, dec)
    if (!m) continue
    const para = montaCaminho(r.para, m.valores)
    if (!caminhoRelativoSeguro(para)) continue // nunca redireciona para fora do site
    return { tipo: 'redireciona', status: r.status, para: para + sufixoQ, motivo: 'redirecionamento' }
  }

  // idioma: prefixo /en/...; o idioma padrão não tem prefixo (URL canônica única)
  let idioma = t.idiomaPadrao
  let resto = dec
  if (t.idiomas.length && dec.length) {
    const achado = t.idiomas.find((x) => x.toLowerCase() === dec[0]!.toLowerCase())
    if (achado) {
      const demais = partes.slice(1)
      if (achado === t.idiomaPadrao) return { tipo: 'redireciona', status: 308, para: '/' + demais.join('/') + sufixoQ, motivo: 'idioma' }
      if (partes[0] !== achado) return { tipo: 'redireciona', status: 308, para: `/${achado}${demais.length ? '/' + demais.join('/') : ''}${sufixoQ}`, motivo: 'idioma' }
      idioma = achado
      resto = dec.slice(1)
    }
  }

  const candidatos = t.entradas
    .map((e) => ({ e, padrao: padraoDe(t, e, idioma) }))
    .sort((a, b) => cmpEspecificidade(a.padrao, b.padrao) || a.e.pagina.localeCompare(b.e.pagina))

  for (const { e, padrao } of candidatos) {
    const m = casaSegmentos(padrao, resto)
    if (!m) continue
    const params: Record<string, unknown> = {}
    let tipoOk = true
    for (const nome of nomesParams(padrao)) {
      const v = m.valores[nome]!
      if (Array.isArray(v)) { params[nome] = v; continue }
      const r = confereValor({ tipo: e.params[nome] ?? 'texto' }, v)
      if (!r.ok) { tipoOk = false; break } // valor que não é do tipo declarado: esta rota não casa (404 cedo)
      params[nome] = r.valor
    }
    if (!tipoOk) continue

    if (e.guarda.length) {
      if (!pedido.sessao) {
        if (t.rotaLogin) {
          const volta = encodeURIComponent(normalizado + sufixoQ)
          // a URL do login varia por idioma (rotasI18n): vem do roteamento reverso da página de login
          const l = t.paginaLogin ? urlDe(t, t.paginaLogin, {}, { idioma }) : null
          const login = l?.ok ? l.url : `${prefixoDe(t, idioma)}${t.rotaLogin}`
          return { tipo: 'redireciona', status: 302, para: `${login}?volta=${volta}`, motivo: 'login' }
        }
        return { tipo: 'negado', status: 401 }
      }
      const faltam = e.guarda.filter((p) => !pedido.sessao!.permissoes.includes(p))
      if (faltam.length) return { tipo: 'negado', status: 403, ...(t.paginaNegado ? { pagina: t.paginaNegado } : {}) }
    }

    const alternativas: Record<string, string> = {}
    for (const l of t.idiomas) { const u = urlDe(t, e.pagina, params, { idioma: l }); if (u.ok) alternativas[l] = u.url }
    const c = urlDe(t, e.pagina, params, { idioma })
    return { tipo: 'pagina', status: 200, pagina: e.pagina, params, idioma, canonica: c.ok ? c.url : normalizado, alternativas }
  }
  return { tipo: 'nao-encontrada', status: 404, ...(t.paginaNaoEncontrada ? { pagina: t.paginaNaoEncontrada } : {}) }
}
