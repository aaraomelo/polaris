import { ALCAS, colocaCentrada, move, redimensiona, redimensionaGirada, redimensionaLocal, type Alca, type Caixa, type Guia } from './geometria'
import { caixasDe, passoDe, type CaixaTela } from './atributos'

// A ILHA da tela de edição (`midia/tela`): no navegador desenha por cima da moldura as caixas (do atributo `data-polaris-caixas`), e traduz mouse, toque e teclado em três eventos que o runtime entrega às ações do bloco:
//   polaris-selecionar { id }                            ao apertar uma caixa
//   polaris-mover { id, topo, esquerda, largura, altura } ao soltar depois de arrastar ou redimensionar (uma vez por gesto) e a cada tecla de seta
//   polaris-soltar { valor, topo, esquerda }              ao soltar sobre a tela um botão com `arrasta` (o centro da peça nova vai ao ponto)
// Só DOM seguro (nada de innerHTML; textos por `textContent`); a posição vive nas props do bloco, a ilha nunca guarda estado do documento: durante o gesto só move o elemento, no fim avisa e o runtime redesenha.

/** o tipo do arrasto: próprio da plataforma, para que texto arrastado de FORA (outra aba, outro app) nunca vire um soltar */
const MIME = 'application/x-polaris-arrasta'
/** o valor do botão que está sendo arrastado (durante o `dragover` o navegador não deixa ler o `dataTransfer`) */
let emArrasto = ''
const ID_ARRASTA = /^[A-Za-z][\w-]{0,119}$/
const r4 = (v: number): number => Math.round(v * 10000) / 10000
const ligadas = new WeakMap<HTMLElement, { sincroniza: () => void }>()

const css = (el: HTMLElement, s: Record<string, string>): void => { for (const [k, v] of Object.entries(s)) el.style.setProperty(k, v) }
const pct = (v: number): string => `${r4(v * 100)}%`

function monta(el: HTMLElement): void {
  const camada = document.createElement('div'); camada.setAttribute('data-tela-camada', '')
  css(camada, { position: 'absolute', inset: '0', 'pointer-events': 'none', overflow: 'hidden' })
  el.appendChild(camada)
  let caixas: CaixaTela[] = [], gesto: { id: string; tipo: 'mover' | 'alca'; alca?: Alca; x0: number; y0: number; ini: Caixa; atual: Caixa; moveu: boolean; pid: number } | null = null
  const nos = new Map<string, HTMLElement>()
  const guias: HTMLElement[] = []
  const passo = (): number => passoDe({ passo: Number(el.getAttribute('data-passo')) })
  const retang = (): DOMRect => el.getBoundingClientRect()
  const emite = (nome: string, detail: unknown): void => { el.dispatchEvent(new CustomEvent(nome, { bubbles: true, detail })) }
  const aplica = (n: HTMLElement, c: Caixa, rot: number): void => css(n, { top: pct(c.topo), left: pct(c.esquerda), width: pct(c.largura), height: pct(c.altura), transform: rot ? `rotate(${-rot}deg)` : '', 'transform-origin': '0% 50%' })
  const limpaGuias = (): void => { for (const g of guias.splice(0)) g.remove() }
  const mostraGuias = (gs: Guia[]): void => {
    limpaGuias()
    for (const g of gs) { const l = document.createElement('div'); l.setAttribute('data-guia', g.eixo); css(l, { position: 'absolute', background: '#f59e0b', 'pointer-events': 'none', ...(g.eixo === 'x' ? { left: pct(g.em), top: '0', width: '1px', height: '100%' } : { top: pct(g.em), left: '0', height: '1px', width: '100%' }) }); camada.appendChild(l); guias.push(l) }
  }
  const outras = (id: string): Caixa[] => caixas.filter((c) => c.id !== id)

  let ultimo = ''
  // a prévia (um iframe isolado) é só uma imagem aqui: sem eventos de ponteiro nela, o mouse nunca é roteado para dentro do quadro (o que travava o arrasto com captura de ponteiro)
  const semPonteiro = (): void => { for (const f of el.querySelectorAll<HTMLElement>(':scope > iframe')) f.style.setProperty('pointer-events', 'none') }
  const sincroniza = (): void => {
    if (gesto) return // não redesenha no meio do gesto
    semPonteiro()
    const texto = `${el.getAttribute('data-polaris-caixas') ?? ''}|${el.getAttribute('data-passo') ?? ''}`; if (texto === ultimo && nos.size > 0) return; ultimo = texto // só redesenha quando as caixas mudaram
    let lidas: CaixaTela[] = []
    try { lidas = caixasDe({ caixas: JSON.parse(el.getAttribute('data-polaris-caixas') ?? '[]') }) } catch { lidas = [] }
    caixas = lidas
    const vistos = new Set(caixas.map((c) => c.id))
    for (const [id, n] of nos) if (!vistos.has(id)) { n.remove(); nos.delete(id) }
    for (const c of caixas) {
      let n = nos.get(c.id)
      if (!n) {
        n = document.createElement('div'); n.setAttribute('data-caixa', c.id); n.setAttribute('role', 'button'); n.tabIndex = 0
        css(n, { position: 'absolute', 'box-sizing': 'border-box', 'pointer-events': 'auto', cursor: 'move', 'touch-action': 'none', 'user-select': 'none' })
        camada.appendChild(n); nos.set(c.id, n)
      }
      n.setAttribute('aria-label', c.rotulo); n.setAttribute('aria-pressed', c.atual ? 'true' : 'false'); n.title = `${c.rotulo}: arraste, ou use as setas (Shift: passo grande; Alt: redimensiona)`
      css(n, { border: c.atual ? '2px solid #f59e0b' : '1px dashed rgba(245,158,11,.7)', background: c.atual ? 'rgba(245,158,11,.10)' : 'transparent', 'z-index': c.atual ? '2' : '1' })
      aplica(n, c, c.rotacao)
      for (const a of [...n.querySelectorAll('[data-alca]')]) a.remove()
      if (c.atual) for (const a of ALCAS) { // as alças giram junto com a caixa (o transform é do pai)
        const h = document.createElement('div'); h.setAttribute('data-alca', a); h.setAttribute('aria-hidden', 'true')
        const cx = a.includes('w') ? '0%' : a.includes('e') ? '100%' : '50%', cy = a.includes('n') ? '0%' : a.includes('s') ? '100%' : '50%'
        css(h, { position: 'absolute', left: cx, top: cy, width: '12px', height: '12px', margin: '-6px 0 0 -6px', background: '#fff', border: '2px solid #f59e0b', 'border-radius': '3px', cursor: `${a}-resize`, 'touch-action': 'none', 'box-sizing': 'border-box' })
        n.appendChild(h)
      }
    }
  }

  camada.addEventListener('pointerdown', (e) => {
    const alvo = e.target as HTMLElement, caixa = alvo.closest<HTMLElement>('[data-caixa]'); if (!caixa || e.button > 0) return
    if (gesto) return // um ponteiro de cada vez
    const id = caixa.getAttribute('data-caixa')!, c = caixas.find((x) => x.id === id); if (!c) return
    const alca = alvo.closest<HTMLElement>('[data-alca]')?.getAttribute('data-alca') as Alca | null
    e.preventDefault(); caixa.focus({ preventScroll: true }); try { caixa.setPointerCapture?.(e.pointerId) } catch { /* ponteiro já inativo */ }
    const ini: Caixa = { topo: c.topo, esquerda: c.esquerda, largura: c.largura, altura: c.altura }
    gesto = { id, tipo: alca ? 'alca' : 'mover', ...(alca ? { alca } : {}), x0: e.clientX, y0: e.clientY, ini, atual: ini, moveu: false, pid: e.pointerId }
    if (!c.atual) emite('polaris-selecionar', { id })
    const esc = (k: KeyboardEvent): void => { if (k.key !== 'Escape' || !gesto) return; gesto = null; limpaGuias(); sincroniza(); document.removeEventListener('keydown', esc, true) } // Esc cancela o gesto: a caixa volta ao que o documento diz
    document.addEventListener('keydown', esc, true); camada.addEventListener('pointerup', () => document.removeEventListener('keydown', esc, true), { once: true })
  })
  camada.addEventListener('pointermove', (e) => {
    if (!gesto || e.pointerId !== gesto.pid) return
    const r = retang(); if (r.width <= 0 || r.height <= 0) return
    const dx = (e.clientX - gesto.x0) / r.width, dy = (e.clientY - gesto.y0) / r.height
    if (!gesto.moveu && Math.hypot(e.clientX - gesto.x0, e.clientY - gesto.y0) < 3) return // um clique não é um arrastar
    gesto.moveu = true
    const rot = caixas.find((x) => x.id === gesto!.id)?.rotacao ?? 0
    const res = gesto.tipo === 'alca' ? (rot ? redimensionaGirada(gesto.ini, gesto.alca!, dx, dy, rot, r.width / r.height, passo()) : redimensiona(gesto.ini, gesto.alca!, dx, dy, passo(), outras(gesto.id))) : move(gesto.ini, dx, dy, passo(), outras(gesto.id))
    gesto.atual = res.caixa; const n = nos.get(gesto.id); if (n) aplica(n, res.caixa, caixas.find((x) => x.id === gesto!.id)?.rotacao ?? 0); mostraGuias(res.guias)
  })
  const fim = (cancelado: boolean) => (e: PointerEvent): void => {
    if (!gesto || e.pointerId !== gesto.pid) return
    const g = gesto; gesto = null; limpaGuias()
    if (cancelado || !g.moveu) { sincroniza(); return }
    emite('polaris-mover', { id: g.id, topo: g.atual.topo, esquerda: g.atual.esquerda, largura: g.atual.largura, altura: g.atual.altura })
    queueMicrotask(() => requestAnimationFrame(() => { ultimo = ''; sincroniza() })) // se o documento recusou ou não mudou, a caixa volta ao que ele diz
  }
  camada.addEventListener('pointerup', fim(false)); camada.addEventListener('pointercancel', fim(true))

  // teclado: setas movem (Shift = passo grande), Alt + setas redimensionam, Enter ou espaço selecionam
  camada.addEventListener('keydown', (e) => {
    const caixa = (e.target as HTMLElement).closest<HTMLElement>('[data-caixa]'); if (!caixa || (e.target as HTMLElement) !== caixa) return
    const id = caixa.getAttribute('data-caixa')!, c = caixas.find((x) => x.id === id); if (!c) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); emite('polaris-selecionar', { id }); return }
    const d: number[] | undefined = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key]; if (!d) return
    e.preventDefault(); const p = passo() * (e.shiftKey ? 10 : 2), box: Caixa = { topo: c.topo, esquerda: c.esquerda, largura: c.largura, altura: c.altura }
    const rr = retang(), prop = rr.height > 0 ? rr.width / rr.height : 1
    const res = e.altKey ? (c.rotacao ? redimensionaLocal(box, d[0] !== 0 ? 'e' : 's', d[0]! * p * prop, d[1]! * p, c.rotacao, prop, passo()) : redimensiona(box, d[0] !== 0 ? 'e' : 's', d[0]! * p, d[1]! * p, passo(), [], 0)) : move(box, d[0]! * p, d[1]! * p, passo(), [], 0)
    if (!c.atual) emite('polaris-selecionar', { id })
    emite('polaris-mover', { id, topo: res.caixa.topo, esquerda: res.caixa.esquerda, largura: res.caixa.largura, altura: res.caixa.altura })
  })

  // soltar um botão com `arrasta` sobre a tela: o centro da peça nova vai ao ponto
  el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } })
  el.addEventListener('drop', (e) => {
    const valor = e.dataTransfer?.getData(MIME) ?? ''; if (!ID_ARRASTA.test(valor)) return
    e.preventDefault(); const r = retang(); if (r.width <= 0 || r.height <= 0) return
    const c = colocaCentrada(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), 0, 0, passo())
    emite('polaris-soltar', { valor, topo: c.topo, esquerda: c.esquerda })
  })

  ligadas.set(el, { sincroniza }); sincroniza()
}

let global: { parar: () => void } | null = null
/** liga a ilha em toda `midia/tela` do documento (as que já existem e as que o runtime criar depois) e dá a todo botão com `data-arrasta` o `dragstart` que leva o valor. Devolve a função que desliga. */
export function ativaTelas(raiz: Document = document): () => void {
  if (global) return global.parar
  const varre = (): void => { for (const el of raiz.querySelectorAll<HTMLElement>('[data-polaris-tela]')) { const l = ligadas.get(el); if (l) l.sincroniza(); else monta(el) } }
  // as mudanças que a própria ilha faz dentro da camada (caixas, alças, guias) NÃO religam nada: sem isso o observador se dispararia em laço
  const obs = new MutationObserver((rs) => { if (rs.every((r) => (r.target as Element).closest?.('[data-tela-camada]'))) return; varre() }); obs.observe(raiz.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-polaris-caixas', 'data-passo'] })
  const dragstart = (e: DragEvent): void => { const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-arrasta]'); const v = b?.getAttribute('data-arrasta') ?? ''; if (b && ID_ARRASTA.test(v) && e.dataTransfer) { emArrasto = v; e.dataTransfer.setData(MIME, v); e.dataTransfer.effectAllowed = 'copyMove' } }
  // enquanto um botão `arrasta` está em movimento, a camada das caixas captura o arrasto (o quadro da prévia é um iframe isolado e engoliria os eventos); ao terminar, volta a deixar o ponteiro passar
  const camadas = (v: string): void => { for (const c of raiz.querySelectorAll<HTMLElement>('[data-tela-camada]')) c.style.setProperty('pointer-events', v) }
  const arrastando = (e: DragEvent): void => { if (toque) { e.preventDefault(); return } dragstart(e); if ((e.target as HTMLElement | null)?.closest?.('[data-arrasta]')) camadas('auto') }
  const solto = (): void => { camadas('none'); limpaZonas(); emArrasto = '' }
  // ZONA DE SOLTAR (`data-solta`, a prop `solta` das caixas de layout): um item `arrasta` solto sobre outro item da mesma zona avisa `polaris-soltar { valor, alvo, zona }`, com a zona pela altura do ponteiro no item (alto = antes, meio = dentro, baixo = depois); o item sob o ponteiro leva `data-solta-zona` para o CSS desenhar a indicação
  const limpaZonas = (): void => { for (const el of raiz.querySelectorAll('[data-solta-zona]')) el.removeAttribute('data-solta-zona') }
  const zonaPorY = (y: number, item: HTMLElement): 'antes' | 'dentro' | 'depois' => { const r = item.getBoundingClientRect(), f = r.height > 0 ? (y - r.top) / r.height : 0.5; return f < 0.3 ? 'antes' : f > 0.7 ? 'depois' : 'dentro' }
  /** o item sob o ponto; fora de qualquer item (entre linhas, numa linha sem `arrasta`, depois do último), o item MAIS PRÓXIMO na vertical: o soltar ambíguo vai para a posição certa em vez de ser perdido (acima do item = antes, abaixo = depois) */
  const itemEm = (alvo: Element | null, y: number): HTMLElement | null => {
    const it = alvo?.closest?.<HTMLElement>('[data-arrasta]'); if (it && it.closest('[data-solta]')) return it
    const zona = alvo?.closest?.<HTMLElement>('[data-solta]'); if (!zona) return null
    let melhor: HTMLElement | null = null, dist = Infinity
    for (const c of zona.querySelectorAll<HTMLElement>('[data-arrasta]')) { const r = c.getBoundingClientRect(); if (r.height <= 0) continue; const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < dist) { dist = d; melhor = c } }
    return melhor
  }
  /** o hospedeiro decide se o soltar vale: `polaris-sobre` (cancelável) com { valor, alvo, zona }; cancelado = inválido (marca vermelha; no arrasto nativo, cursor de proibido e sem soltar). Marca o item sob o ponteiro. */
  const avalia = (it: HTMLElement, y: number, valor: string): { vale: boolean; zona: 'antes' | 'dentro' | 'depois' } => {
    const zona = zonaPorY(y, it), vale = it.closest('[data-solta]')!.dispatchEvent(new CustomEvent('polaris-sobre', { bubbles: true, cancelable: true, detail: { valor, alvo: it.getAttribute('data-arrasta') ?? '', zona } })) !== false
    const marca = vale ? zona : 'invalida'; if (it.getAttribute('data-solta-zona') !== marca) { limpaZonas(); it.setAttribute('data-solta-zona', marca) }
    return { vale, zona }
  }
  const avisaSoltar = (it: HTMLElement, valor: string, zona: string): void => { const alvo = it.getAttribute('data-arrasta') ?? ''; if (ID_ARRASTA.test(valor) && ID_ARRASTA.test(alvo)) it.closest('[data-solta]')!.dispatchEvent(new CustomEvent('polaris-soltar', { bubbles: true, detail: { valor, alvo, zona } })) }
  const sobre = (e: DragEvent): void => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes(MIME)) return
    const it = itemEm(e.target as Element | null, e.clientY); if (!it) return
    const { vale } = avalia(it, e.clientY, emArrasto)
    if (vale) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } else e.dataTransfer.dropEffect = 'none'
  }
  const soltou = (e: DragEvent): void => {
    const it = itemEm(e.target as Element | null, e.clientY); if (!it) return
    const marcado = it.getAttribute('data-solta-zona') === 'invalida', valor = e.dataTransfer?.getData(MIME) ?? ''; limpaZonas(); if (marcado) return
    e.preventDefault(); avisaSoltar(it, valor, zonaPorY(e.clientY, it))
  }
  const saiu = (e: DragEvent): void => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('[data-solta]')) limpaZonas() }
  // ARRASTAR POR TOQUE: o arrastar nativo do HTML não é confiável em telas de toque; aqui, uma pressão longa num botão `arrasta` começa o arrasto (um fantasma segue o dedo, a lista rola perto das bordas) e o soltar chama a mesma lógica do mouse. Mexer antes da pressão longa é rolar a página, como sempre.
  const LONGA = 350, TOLERANCIA = 10, BORDA = 56
  let toque: { it: HTMLElement; valor: string; x0: number; y0: number; x: number; y: number; id: number; timer: number; ativo: boolean; fantasma?: HTMLElement; raf?: number } | null = null
  const rolavel = (el: Element | null): HTMLElement | null => { for (let n = el?.parentElement ?? null; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n } return null }
  const alvoDoToque = (): void => {
    if (!toque) return
    const el = raiz.elementFromPoint(toque.x, toque.y), it = itemEm(el, toque.y); if (it) avalia(it, toque.y, toque.valor); else limpaZonas()
  }
  const fimDoToque = (solta: boolean): void => {
    const t = toque; if (!t) return; toque = null; clearTimeout(t.timer); if (t.raf) cancelAnimationFrame(t.raf); t.fantasma?.remove()
    if (!t.ativo) return
    const el = raiz.elementFromPoint(t.x, t.y), it = itemEm(el, t.y), marcado = it?.getAttribute('data-solta-zona') === 'invalida'; limpaZonas(); emArrasto = ''
    // o toque que fecha o arrasto não vira clique no botão
    const engole = (c: Event): void => { c.preventDefault(); c.stopPropagation() }; raiz.addEventListener('click', engole, { capture: true, once: true }); setTimeout(() => raiz.removeEventListener('click', engole, true), 500)
    if (!solta) return
    if (it) { if (!marcado) avisaSoltar(it, t.valor, zonaPorY(t.y, it)); return }
    const tela = el?.closest?.<HTMLElement>('[data-polaris-tela]'); if (!tela) return // sobre a tela de edição: cria no ponto (o mesmo `polaris-soltar` do mouse)
    const r = tela.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return
    const c = colocaCentrada(Math.min(1, Math.max(0, (t.x - r.left) / r.width)), Math.min(1, Math.max(0, (t.y - r.top) / r.height)), 0, 0, passoDe({ passo: Number(tela.getAttribute('data-passo')) }))
    if (ID_ARRASTA.test(t.valor)) tela.dispatchEvent(new CustomEvent('polaris-soltar', { bubbles: true, detail: { valor: t.valor, topo: c.topo, esquerda: c.esquerda } }))
  }
  const comecaToque = (): void => {
    const t = toque; if (!t) return; t.ativo = true; emArrasto = t.valor
    const f = document.createElement('div'); f.setAttribute('data-arrasto-toque', ''); f.textContent = (t.it.textContent ?? '').trim().slice(0, 40)
    f.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:6px 10px;border-radius:8px;background:#f59e0b;color:#111;font:600 14px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);opacity:.92;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;left:0;top:0;transform:translate(' + (t.x + 14) + 'px,' + (t.y - 18) + 'px)'
    document.body.appendChild(f); t.fantasma = f; navigator.vibrate?.(15)
    const ciclo = (): void => { // autorrolagem nas bordas, e o alvo é recalculado (a lista anda sob o dedo)
      if (!toque) return; const box = rolavel(t.it), topo = box ? box.getBoundingClientRect().top : 0, base = box ? box.getBoundingClientRect().bottom : innerHeight
      const d = toque.y < topo + BORDA ? -10 : toque.y > base - BORDA ? 10 : 0
      if (d) { if (box) box.scrollTop += d; else scrollBy(0, d); alvoDoToque() }
      toque.raf = requestAnimationFrame(ciclo)
    }
    t.raf = requestAnimationFrame(ciclo); alvoDoToque()
  }
  const toqueBaixo = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || toque) return
    const it = (e.target as Element | null)?.closest?.<HTMLElement>('[data-arrasta]'); const valor = it?.getAttribute('data-arrasta') ?? ''; if (!it || !ID_ARRASTA.test(valor)) return
    toque = { it, valor, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId, ativo: false, timer: window.setTimeout(comecaToque, LONGA) }
  }
  const toqueMove = (e: PointerEvent): void => {
    if (!toque || e.pointerId !== toque.id) return; toque.x = e.clientX; toque.y = e.clientY
    if (!toque.ativo) { if (Math.hypot(e.clientX - toque.x0, e.clientY - toque.y0) > TOLERANCIA) fimDoToque(false); return } // mexeu antes da pressão longa: é rolagem
    if (toque.fantasma) toque.fantasma.style.transform = `translate(${toque.x + 14}px,${toque.y - 18}px)`; alvoDoToque()
  }
  const toqueCima = (cancelado: boolean) => (e: PointerEvent): void => { if (toque && e.pointerId === toque.id) fimDoToque(!cancelado) }
  const naoRola = (e: TouchEvent): void => { if (toque?.ativo && e.cancelable) e.preventDefault() } // durante o arrasto o dedo não rola a página
  const semMenu = (e: Event): void => { if (toque) e.preventDefault() } // a pressão longa não abre o menu de contexto
  const cimaSolta = toqueCima(false) as EventListener, cimaCancela = toqueCima(true) as EventListener
  raiz.addEventListener('pointerdown', toqueBaixo as EventListener); raiz.addEventListener('pointermove', toqueMove as EventListener); raiz.addEventListener('pointerup', cimaSolta); raiz.addEventListener('pointercancel', cimaCancela)
  raiz.addEventListener('touchmove', naoRola as EventListener, { passive: false }); raiz.addEventListener('contextmenu', semMenu)
  raiz.addEventListener('dragover', sobre); raiz.addEventListener('drop', soltou); raiz.addEventListener('dragleave', saiu)
  raiz.addEventListener('dragstart', arrastando); raiz.addEventListener('pointerdown', solto, true); raiz.addEventListener('dragend', solto, true); raiz.addEventListener('drop', solto, true); varre()
  global = { parar: () => { obs.disconnect(); raiz.removeEventListener('dragstart', arrastando); raiz.removeEventListener('pointerdown', solto, true); raiz.removeEventListener('dragend', solto, true); raiz.removeEventListener('drop', solto, true); raiz.removeEventListener('dragover', sobre); raiz.removeEventListener('drop', soltou); raiz.removeEventListener('dragleave', saiu); raiz.removeEventListener('pointerdown', toqueBaixo as EventListener); raiz.removeEventListener('pointermove', toqueMove as EventListener); raiz.removeEventListener('pointerup', cimaSolta); raiz.removeEventListener('pointercancel', cimaCancela); raiz.removeEventListener('touchmove', naoRola as EventListener); raiz.removeEventListener('contextmenu', semMenu); fimDoToque(false); global = null } }
  return global.parar
}
