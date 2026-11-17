import { iniciaCargas, type OpcoesCarga } from '../dados/carrega'
import { codificaChave } from '../estatico/gera'
import { compilaHtmlVivo } from '../estatico/index'
import { jsonSeguro } from '../render/json'
import type { ConfigCodigo } from '../codigo/sessao'
import type { Programa } from '../render/programa'
import { iniciaStore, reduz, type Store } from '../render/store'
import type { DescritoresDom } from './blocos'

// ---------------------------------------------------------------------------
// SSR EM STREAMING SEM REACT (servidor). O HTML sai assim que o "shell" está pronto (dados bloqueantes resolvidos; fronteiras de streaming
// com esqueleto) e cada dado em streaming chega depois como um pedaço JSON, na ordem em que resolve:
//   - o script de BOOT (um só, estático: um hash de CSP serve a todas as páginas) guarda os pedaços numa fila e, enquanto o runtime ainda
//     não montou, TROCA no DOM o HTML das fronteiras que o servidor sabe renderizar sozinho (escopo da página);
//   - depois da montagem o runtime recebe só os dados (`chega`) e renderiza ele mesmo — o HTML não é tocado.
// Hidratar em qualquer ponto dá o mesmo DOM: o estado semeado (dados que chegaram) é exatamente o que o DOM mostra. As fronteiras que o
// servidor não consegue renderizar (dentro de repetir ou de bloco composto) e os dados que elas usam esperam a hidratação (`tarde`).
// Sem Suspense, sem scripts por pedaço (só JSON inerte): compatível com CSP estrita.
// ---------------------------------------------------------------------------

/** Script de boot (inline, no <head>): fila + troca de HTML + observador dos pedaços. Hash de CSP: `hashDoBoot`. */
export const BOOT = `(function(w,d){var q=w.__PL=w.__PL||{fila:[],montado:null};q.auto=true;` +
  `function acha(k,f){var r=d.getElementById('polaris')||d.body;var it=d.createNodeIterator(r,128),n;while((n=it.nextNode()))if(n.data===(f?'/f:':'f:')+k)return n;return null}` +
  `function troca(k,h){var a=acha(k,0),b=acha(k,1);if(!a||!b)return;while(a.nextSibling&&a.nextSibling!==b)a.parentNode.removeChild(a.nextSibling);var t=d.createElement('template');t.innerHTML=h;b.parentNode.insertBefore(t.content,b)}` +
  `function proc(s){var c;try{c=JSON.parse(s.textContent)}catch(e){return}if(q.montado){q.montado.chega((c.d||[]).map(function(x){return[x[0],x[1],x[2]]}));return}(c.s||[]).forEach(function(x){troca(x[0],x[1])});q.fila.push(c)}` +
  `function varre(){var l=d.querySelectorAll('script[data-pl-c]:not([data-pl-ok])');for(var i=0;i<l.length;i++){var s=l[i],f=s.nextElementSibling;if(f&&f.hasAttribute('data-pl-f')){s.setAttribute('data-pl-ok','');proc(s)}}}` +
  `new MutationObserver(varre).observe(d,{childList:true,subtree:true})})(window,document)`

export const hashDoBoot = async (): Promise<string> => `sha256-${(await import('node:crypto')).createHash('sha256').update(BOOT).digest('base64')}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type OpcoesStreamVivo = OpcoesCarga & {
  /** URL do bundle do cliente (AOT) */
  clienteSrc: string
  lang?: string
  descritores?: DescritoresDom
  /** robôs/SEO: espera TUDO e manda a página completa de uma vez (sem esqueletos) */
  esperaTudo?: boolean
  /** dado que não resolver em tanto tempo vira erro "tempo esgotado" (a página continua); padrão 20000 ms */
  abortaEmMs?: number
  /** nonce de CSP para os scripts inline (boot e inicialização) */
  nonce?: string
  /** folhas de estilo (href), p.ex. o CSS do tema; vão no <head> antes do conteúdo (sem flash sem estilo) */
  estilos?: string[]
  /** modo do tema (`data-modo` no <html>); sem ele, segue prefers-color-scheme */
  modo?: string
  /** executor isolado dos blocos de código (SSR); o `agora` é decidido UMA vez aqui e vai no estado para o cliente reproduzir a saída */
  codigo?: ConfigCodigo
}

/**
 * Documento HTML em pedaços. Rejeita (antes de qualquer byte) se a página não for suportada pelo runtime vivo.
 * Falha de dado nunca derruba a página: vira `erro` daquele dado, opaco (o detalhe vai para `onErro`).
 */
export async function* streamVivo(programa: Programa, opcoes: OpcoesStreamVivo): AsyncGenerator<string, void, void> {
  const h = compilaHtmlVivo(programa, opcoes.descritores)
  if (!h.ok) throw new Error(`a página não roda no runtime vivo: ${h.motivos.map((m) => `${m.caminho}: ${m.motivo}`).join('; ')}`)
  const pagina = h.pagina
  const cargas = iniciaCargas(programa, opcoes)
  const bloq = await cargas.bloqueantes
  const codigo = opcoes.codigo ? { ...opcoes.codigo, agora: opcoes.codigo.agora ?? new Date().toISOString() } : undefined
  const base = { params: opcoes.params, consulta: opcoes.consulta, tenant: opcoes.tenant, idioma: opcoes.idioma, ...(codigo ? { codigo } : {}) }
  const entrada = (s: Store) => ({ ...base, estado: s.estado, dados: s.dados, status: s.status, erros: s.erros })
  let store: Store = iniciaStore(programa, { ...(opcoes.estado ? { estado: opcoes.estado } : {}), dados: bloq.dados, status: bloq.status, erros: bloq.erros })

  const pendentes = new Map(Object.entries(cargas.stream))
  const aplica = (nome: string, r: { ok: true; valor: unknown } | { ok: false; erro: string }) => { store = reduz(store, r.ok ? { t: 'dado', nome, valor: r.valor } : { t: 'erro', nome, erro: r.erro }) }
  if (opcoes.esperaTudo) { for (const [nome, p] of pendentes) aplica(nome, await p); pendentes.clear() }

  const shell = pagina.render(entrada(store))
  const nonce = opcoes.nonce ? ` nonce="${esc(opcoes.nonce)}"` : ''
  const seed = { params: opcoes.params, consulta: opcoes.consulta, tenant: opcoes.tenant, idioma: opcoes.idioma, estado: store.estado, dados: store.dados, status: store.status, erros: store.erros, ...(codigo?.agora ? { agora: codigo.agora } : {}) }
  const links = (opcoes.estilos ?? []).map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join('')
  yield `<!doctype html><html lang="${esc(opcoes.lang ?? opcoes.idioma ?? 'pt-BR')}"${opcoes.modo ? ` data-modo="${esc(opcoes.modo)}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(shell.titulo)}</title>${links}` +
    `<script${nonce}>${BOOT}</script><script${nonce} async src="${esc(opcoes.clienteSrc)}"></script></head>` +
    `<body><div id="polaris">${shell.corpo}</div>` +
    `<script type="application/json" id="pl-programa">${jsonSeguro(programa)}</script><script type="application/json" id="pl-estado">${jsonSeguro(seed)}</script>`

  const retidas = new Set(pagina.retidas)
  const limite = opcoes.abortaEmMs ?? 20000
  const inicio = Date.now()
  const pedaco = (nome: string): string => {
    // fronteiras que ficaram prontas com este dado e o servidor sabe trocar no HTML
    const trocas = pagina.fronteiras.filter((f) => f.trocavel && f.vars.includes(nome) && f.vars.every((v) => store.status[v] !== 'carregando'))
      .map((f) => [f.chave, pagina.renderFronteira(f.chave, entrada(store))] as const)
    const d = store.status[nome] === 'ok' ? [nome, true, store.dados[nome], retidas.has(nome)] : [nome, false, store.erros[nome] ?? 'erro', retidas.has(nome)]
    return `<script type="application/json" data-pl-c>${jsonSeguro({ d: [d], ...(trocas.length ? { s: trocas } : {}) })}</script><i data-pl-f hidden></i>`
  }
  while (pendentes.size) {
    const restante = Math.max(0, limite - (Date.now() - inicio))
    let timer: ReturnType<typeof setTimeout> | undefined
    const prazo = new Promise<null>((r) => { timer = setTimeout(() => r(null), restante) })
    const pronto = await Promise.race([prazo, ...[...pendentes].map(async ([nome, p]) => ({ nome, r: await p }))])
    clearTimeout(timer)
    if (pronto === null) { // estourou o prazo: o que falta vira erro (a fronteira sai do esqueleto)
      for (const nome of [...pendentes.keys()]) { pendentes.delete(nome); aplica(nome, { ok: false, erro: 'tempo esgotado' }); yield pedaco(nome) }
      break
    }
    pendentes.delete(pronto.nome)
    aplica(pronto.nome, pronto.r)
    yield pedaco(pronto.nome)
  }
  yield '</body></html>'
}

/** Junta o documento inteiro (testes e respostas sem streaming). */
export async function textoDoStreamVivo(g: AsyncGenerator<string>): Promise<string> { let t = ''; for await (const c of g) t += c; return t }
