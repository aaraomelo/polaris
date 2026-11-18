import type { Carregador } from '@polaris/engine'

// O CARREGADOR de dados do Studio no navegador: traduz `servico studio . operação` (o contrato declarado em packages/packs/nos/studio/servico.json) para a API REST de autoria, com o token da sessão.
// O mapa abaixo é a ÚNICA ligação entre o nó `servico` e o HTTP; um teste confere que não faltam nem sobram operações.
type Req = { metodo: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; corpo?: unknown }
const e = encodeURIComponent
const idNaUrl = (id: unknown) => String(id).split('/').map(e).join('/')
const sem = (o: Record<string, unknown>, ...ks: string[]) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !ks.includes(k) && v !== undefined))

export const OPERACOES: Record<string, (a: Record<string, unknown>) => Req> = {
  listarNos: () => ({ metodo: 'GET', url: '/studio/nos' }),
  listarBlocos: () => ({ metodo: 'GET', url: '/studio/blocos' }),
  abrirNo: (a) => ({ metodo: 'GET', url: `/studio/nos/${e(String(a.kind))}/${idNaUrl(a.id)}` }),
  salvarNo: (a) => ({ metodo: 'PUT', url: `/studio/nos/${e(String(a.kind))}/${idNaUrl(a.id)}`, corpo: sem({ no: a.no, baseSeq: a.baseSeq, nota: a.nota || undefined }) }),
  restaurarPadrao: (a) => ({ metodo: 'DELETE', url: `/studio/nos/${e(String(a.kind))}/${idNaUrl(a.id)}` }),
  listarVersoes: (a) => ({ metodo: 'GET', url: `/studio/historico/${e(String(a.kind))}/${idNaUrl(a.id)}?limite=100` }),
  abrirVersao: (a) => ({ metodo: 'GET', url: `/studio/versao/${e(String(a.kind))}/${idNaUrl(a.id)}?seq=${e(String(a.seq))}` }),
  compararVersoes: (a) => ({ metodo: 'GET', url: `/studio/diff/${e(String(a.kind))}/${idNaUrl(a.id)}?de=${e(String(a.de))}&para=${e(String(a.para))}` }),
  listarComentarios: (a) => ({ metodo: 'GET', url: `/studio/comentarios?kind=${e(String(a.kind))}&id=${e(String(a.id))}` }),
  comentar: (a) => ({ metodo: 'POST', url: '/studio/comentarios', corpo: sem({ kind: a.kind, id: a.id, texto: a.texto, ancora: a.ancora || undefined, versao: typeof a.versao === 'number' ? a.versao : undefined, respondeA: a.respondeA || undefined }) }),
  resolverComentario: (a) => ({ metodo: 'POST', url: `/studio/comentarios/${e(String(a.cid))}/resolver`, corpo: { resolvido: a.resolvido } }),
  previsualizar: (a) => ({ metodo: 'POST', url: '/studio/previa', corpo: sem({ no: a.no, tema: a.tema ?? undefined, selecionado: a.selecionado || undefined }) }),
}

/** o token do gateway chega no fragmento (`/studio#token=…`), vive só em `sessionStorage` e o fragmento some da barra de endereço; sem token vale a sessão por cookie (dev) */
export function tokenDaSessao(): string | undefined {
  try {
    const m = /(?:^#|&)token=([A-Za-z0-9._~-]{20,4096})(?:&|$)/.exec(location.hash)
    if (m) { sessionStorage.setItem('polaris.token', m[1]!); history.replaceState(null, '', location.pathname + location.search) }
    return sessionStorage.getItem('polaris.token') ?? undefined
  } catch { return undefined }
}

export class ErroStudio extends Error { constructor(readonly status: number, readonly codigo: string, mensagem: string, readonly extra: Record<string, unknown> = {}) { super(mensagem); this.name = 'ErroStudio' } }

export async function chama(operacao: string, args: Record<string, unknown>, o: { fetch?: typeof fetch; token?: string | undefined } = {}): Promise<unknown> {
  const monta = Object.hasOwn(OPERACOES, operacao) ? OPERACOES[operacao] : undefined
  if (!monta) throw new ErroStudio(0, 'operacao_desconhecida', `operação desconhecida: ${operacao}`)
  const r = monta(args), tk = o.token ?? tokenDaSessao()
  const res = await (o.fetch ?? fetch)(r.url, { method: r.metodo, headers: { ...(r.corpo === undefined ? {} : { 'content-type': 'application/json' }), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, ...(r.corpo === undefined ? {} : { body: JSON.stringify(r.corpo) }), credentials: 'same-origin' })
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null } catch { /* não-JSON */ }
  if (!res.ok) { const x = j?.erro ?? {}; const det = Array.isArray(x.erros) && x.erros.length ? `: ${x.erros.slice(0, 3).join('; ')}` : ''; throw new ErroStudio(res.status, x.codigo ?? 'erro', `${x.mensagem ?? `erro ${res.status}`}${det}`, x) }
  return j
}

/** o carregador que o runtime usa na ação `executar`: descobre a operação pela declaração do dado no programa */
type ProgramaDados = { pagina: { dados: Record<string, { id: string }>; fontes: Record<string, { fonte: { servico?: string; operacao?: string }; carregar: 'auto' | 'manual' }> } }
export const fonteDe = (programa: ProgramaDados, nome: string) => { const d = Object.hasOwn(programa.pagina.dados, nome) ? programa.pagina.dados[nome] : undefined; return d && Object.hasOwn(programa.pagina.fontes, d.id) ? programa.pagina.fontes[d.id] : undefined }
export const criaCarregador = (programa: ProgramaDados, o: Parameters<typeof chama>[2] = {}): Carregador =>
  async ({ dados, args }) => {
    const f = fonteDe(programa, dados)?.fonte
    if (!f || f.servico !== 'studio' || !f.operacao) throw new ErroStudio(0, 'dado_desconhecido', `o dado ${dados} não é do serviço studio`)
    return chama(f.operacao, args, o)
  }
