import { ALCAS, colocaCentrada, move, redimensiona, type Alca, type Caixa, type Guia } from './geometria'
import { caixasDe, passoDe, type CaixaTela } from './atributos'

// A ILHA da tela de edição (`midia/tela`): no navegador desenha por cima da moldura as caixas (do atributo `data-polaris-caixas`), e traduz mouse, toque e teclado em três eventos que o runtime entrega às ações do bloco:
//   polaris-selecionar { id }                            ao apertar uma caixa
//   polaris-mover { id, topo, esquerda, largura, altura } ao soltar depois de arrastar ou redimensionar (uma vez por gesto) e a cada tecla de seta
//   polaris-soltar { valor, topo, esquerda }              ao soltar sobre a tela um botão com `arrasta` (o centro da peça nova vai ao ponto)
// Só DOM seguro (nada de innerHTML; textos por `textContent`); a posição vive nas props do bloco, a ilha nunca guarda estado do documento: durante o gesto só move o elemento, no fim avisa e o runtime redesenha.

/** o tipo do arrasto: próprio da plataforma, para que texto arrastado de FORA (outra aba, outro app) nunca vire um soltar */
const MIME = 'application/x-polaris-arrasta'
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
  const sincroniza = (): void => {
    if (gesto) return // não redesenha no meio do gesto
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
      if (c.atual && !c.rotacao) for (const a of ALCAS) { // girada: sem alças (os eixos da alça e do modelo não coincidem); mover continua valendo
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
  })
  camada.addEventListener('pointermove', (e) => {
    if (!gesto || e.pointerId !== gesto.pid) return
    const r = retang(); if (r.width <= 0 || r.height <= 0) return
    const dx = (e.clientX - gesto.x0) / r.width, dy = (e.clientY - gesto.y0) / r.height
    if (!gesto.moveu && Math.hypot(e.clientX - gesto.x0, e.clientY - gesto.y0) < 3) return // um clique não é um arrastar
    gesto.moveu = true
    const res = gesto.tipo === 'alca' ? redimensiona(gesto.ini, gesto.alca!, dx, dy, passo(), outras(gesto.id)) : move(gesto.ini, dx, dy, passo(), outras(gesto.id))
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
    const res = e.altKey ? redimensiona(box, d[0] !== 0 ? 'e' : 's', d[0]! * p, d[1]! * p, passo(), [], 0) : move(box, d[0]! * p, d[1]! * p, passo(), [], 0)
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
  const dragstart = (e: DragEvent): void => { const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-arrasta]'); const v = b?.getAttribute('data-arrasta') ?? ''; if (b && ID_ARRASTA.test(v) && e.dataTransfer) { e.dataTransfer.setData(MIME, v); e.dataTransfer.effectAllowed = 'copyMove' } }
  // enquanto um botão `arrasta` está em movimento, a camada das caixas captura o arrasto (o quadro da prévia é um iframe isolado e engoliria os eventos); ao terminar, volta a deixar o ponteiro passar
  const camadas = (v: string): void => { for (const c of raiz.querySelectorAll<HTMLElement>('[data-tela-camada]')) c.style.setProperty('pointer-events', v) }
  const arrastando = (e: DragEvent): void => { dragstart(e); if ((e.target as HTMLElement | null)?.closest?.('[data-arrasta]')) camadas('auto') }
  const solto = (): void => { camadas('none'); limpaZonas() }
  // ZONA DE SOLTAR (`data-solta`, a prop `solta` das caixas de layout): um item `arrasta` solto sobre outro item da mesma zona avisa `polaris-soltar { valor, alvo, zona }`, com a zona pela altura do ponteiro no item (alto = antes, meio = dentro, baixo = depois); o item sob o ponteiro leva `data-solta-zona` para o CSS desenhar a indicação
  const limpaZonas = (): void => { for (const el of raiz.querySelectorAll('[data-solta-zona]')) el.removeAttribute('data-solta-zona') }
  const zonaDe = (e: DragEvent, item: HTMLElement): 'antes' | 'dentro' | 'depois' => { const r = item.getBoundingClientRect(), f = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5; return f < 0.3 ? 'antes' : f > 0.7 ? 'depois' : 'dentro' }
  const itemDaZona = (e: Event): HTMLElement | null => { const it = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-arrasta]'); return it && it.closest('[data-solta]') ? it : null }
  const sobre = (e: DragEvent): void => {
    const it = itemDaZona(e); if (!it || !e.dataTransfer || ![...e.dataTransfer.types].includes(MIME)) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const z = zonaDe(e, it)
    if (it.getAttribute('data-solta-zona') !== z) { limpaZonas(); it.setAttribute('data-solta-zona', z) }
  }
  const soltou = (e: DragEvent): void => {
    const it = itemDaZona(e); if (!it) return
    const valor = e.dataTransfer?.getData(MIME) ?? '', alvo = it.getAttribute('data-arrasta') ?? ''; limpaZonas()
    if (!ID_ARRASTA.test(valor) || !ID_ARRASTA.test(alvo)) return
    e.preventDefault(); it.closest('[data-solta]')!.dispatchEvent(new CustomEvent('polaris-soltar', { bubbles: true, detail: { valor, alvo, zona: zonaDe(e, it) } }))
  }
  const saiu = (e: DragEvent): void => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('[data-solta]')) limpaZonas() }
  raiz.addEventListener('dragover', sobre); raiz.addEventListener('drop', soltou); raiz.addEventListener('dragleave', saiu)
  raiz.addEventListener('dragstart', arrastando); raiz.addEventListener('pointerdown', solto, true); raiz.addEventListener('dragend', solto, true); raiz.addEventListener('drop', solto, true); varre()
  global = { parar: () => { obs.disconnect(); raiz.removeEventListener('dragstart', arrastando); raiz.removeEventListener('pointerdown', solto, true); raiz.removeEventListener('dragend', solto, true); raiz.removeEventListener('drop', solto, true); raiz.removeEventListener('dragover', sobre); raiz.removeEventListener('drop', soltou); raiz.removeEventListener('dragleave', saiu); global = null } }
  return global.parar
}
