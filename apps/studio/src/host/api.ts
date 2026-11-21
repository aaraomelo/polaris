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
  publicarSite: (a) => ({ metodo: 'POST', url: '/studio/publicar', corpo: sem({ nota: a.nota || undefined }) }),
  obterSite: () => ({ metodo: 'GET', url: '/studio/site' }),
  definirTemaDoSite: (a) => ({ metodo: 'PUT', url: '/studio/site', corpo: { tema: a.tema } }),
  definirPaginaNoSite: (a) => ({ metodo: 'PUT', url: '/studio/site/paginas', corpo: { pagina: a.pagina, mostrar: a.mostrar } }),
  listarAtivos: () => ({ metodo: 'GET', url: '/studio/ativos' }),
  enviarAtivo: (a) => ({ metodo: 'POST', url: '/studio/ativos', corpo: { nome: a.nome, dados: a.dados } }),
  removerAtivo: (a) => ({ metodo: 'DELETE', url: `/studio/ativos/${e(String(a.hash))}` }),
  listarReleases: () => ({ metodo: 'GET', url: '/studio/releases' }),
  linkDePreview: (a) => ({ metodo: 'POST', url: '/studio/releases/preview', corpo: sem({ release: a.release, horas: typeof a.horas === 'number' ? a.horas : undefined }) }),
  voltarRelease: (a) => ({ metodo: 'POST', url: '/studio/releases/voltar', corpo: sem({ para: typeof a.para === 'number' ? a.para : undefined, nota: a.nota || undefined }) }),
  compararReleases: (a) => ({ metodo: 'GET', url: `/studio/releases/diff?de=${e(String(a.de))}&para=${e(String(a.para))}` }),
  listarModelos: () => ({ metodo: 'GET', url: '/studio/templates' }),
  manifestoDoModelo: (a) => ({ metodo: 'GET', url: `/studio/templates/${e(String(a.slug))}/manifesto` }),
  abrirNoDoModelo: (a) => ({ metodo: 'GET', url: `/studio/templates/${e(String(a.slug))}/nos/${e(String(a.kind))}/${idNaUrl(a.id)}` }),
  aplicarModelo: (a) => ({ metodo: 'POST', url: `/studio/templates/${e(String(a.slug))}/aplicar`, corpo: sem({ publicar: typeof a.publicar === 'boolean' ? a.publicar : undefined, nota: a.nota || undefined }) }),
  diagramar: (a) => ({ metodo: 'POST', url: '/studio/diagrama', corpo: sem({ tipo: a.tipo, no: a.no ?? undefined, selecionado: a.selecionado || undefined }) }),
  previsualizar: (a) => ({ metodo: 'POST', url: '/studio/previa', corpo: sem({ no: a.no, tema: a.tema ?? undefined, selecionado: a.selecionado || undefined, modo: a.modo || undefined, dados: a.dados ?? undefined }) }),
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
  const res = await (o.fetch ?? fetch)(r.url, { method: r.metodo, headers: { ...(r.corpo === undefined ? {} : { 'content-type': 'application/json' }), ...(tk ? { authorization: `Bearer ${tk}` } : { 'x-polaris-studio': '1' }) }, ...(r.corpo === undefined ? {} : { body: JSON.stringify(r.corpo) }), credentials: 'same-origin' })
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null } catch { /* não-JSON */ }
  if (res.status === 401 && !tk && o.fetch === undefined && typeof location !== 'undefined') { location.assign(`/entrar?volta=${encodeURIComponent('/studio')}`); throw new ErroStudio(401, 'nao_autenticado', 'entre para usar o Studio') } // sem token e sem sessão: o login do site, e volta para cá
  if (!res.ok) { const x = j?.erro ?? {}; const det = Array.isArray(x.erros) && x.erros.length ? `: ${x.erros.slice(0, 3).join('; ')}` : ''; throw new ErroStudio(res.status, x.codigo ?? 'erro', `${x.mensagem ?? `erro ${res.status}`}${det}`, x) }
  return j
}

/** o carregador que o runtime usa na ação `executar`: descobre a operação pela declaração do dado no programa */
type ProgramaDados = { pagina: { dados: Record<string, { id: string }>; fontes: Record<string, { fonte: { servico?: string; operacao?: string }; carregar: 'auto' | 'manual' }> } }
export const fonteDe = (programa: ProgramaDados, nome: string) => { const d = Object.hasOwn(programa.pagina.dados, nome) ? programa.pagina.dados[nome] : undefined; return d && Object.hasOwn(programa.pagina.fontes, d.id) ? programa.pagina.fontes[d.id] : undefined }
/** operações que o editor dispara a cada tecla: esperam um instante (só a ÚLTIMA chamada de uma rajada sai) e a requisição anterior ainda em voo é cancelada. A chamada superada devolve `undefined` e é ignorada pelo runtime (a ação `executar` só aplica a resposta da última). */
export const ATRASO_MS: Record<string, number> = { previsualizar: 150 }
export const criaCarregador = (programa: ProgramaDados, o: Parameters<typeof chama>[2] = {}): Carregador => {
  const pendente = new Map<string, { timer: ReturnType<typeof setTimeout>; fim: (v: unknown) => void; abre: AbortController }>()
  return async ({ dados, args }) => {
    const f = fonteDe(programa, dados)?.fonte
    if (!f || f.servico !== 'studio' || !f.operacao) throw new ErroStudio(0, 'dado_desconhecido', `o dado ${dados} não é do serviço studio`)
    const atraso = Object.hasOwn(ATRASO_MS, f.operacao) ? ATRASO_MS[f.operacao]! : 0
    if (!atraso) return chama(f.operacao, args, o)
    const anterior = pendente.get(f.operacao); if (anterior) { clearTimeout(anterior.timer); anterior.abre.abort(); anterior.fim(undefined) }
    const abre = new AbortController(), base = o.fetch ?? fetch, op = f.operacao
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { chama(op, args, { ...o, fetch: (u, init) => base(u, { ...init, signal: abre.signal }) }).then(resolve, (e) => (abre.signal.aborted ? resolve(undefined) : reject(e))).finally(() => { if (pendente.get(op)?.abre === abre) pendente.delete(op) }) }, atraso)
      pendente.set(op, { timer, fim: resolve, abre })
    })
  }
}
