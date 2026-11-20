import { montaVivo, type Programa } from '@polaris/engine'
import '@polaris/engine/formulario' // registra o validador na função `validaFormulario` (o painel de teste do editor de formulários)
import { criaCarregador, fonteDe } from './api'

// O hospedeiro: carrega o PROGRAMA da página `studio.app` (compilado em build a partir dos nós JSON), resolve os dados `auto` e monta a página com o runtime vivo da plataforma.
async function inicia(): Promise<void> {
  const raiz = document.getElementById('polaris')!
  try {
    const programa = (await (await fetch('/studio/ativos/studio.programa.json', { credentials: 'same-origin' })).json()) as Programa
    const carregador = criaCarregador(programa as never)
    const dados: Record<string, unknown> = {}, status: Record<string, 'ok' | 'erro'> = {}, erros: Record<string, string> = {}
    await Promise.all(Object.keys(programa.pagina.dados).filter((nome) => fonteDe(programa as never, nome)?.carregar === 'auto').map(async (nome) => {
      try { dados[nome] = await carregador({ dados: nome, args: {}, estado: {} }); status[nome] = 'ok' } catch (e) { status[nome] = 'erro'; erros[nome] = (e as Error).message }
    }))
    montaVivo({ programa, container: raiz, carregador, dados, status, erros, onErro: (e) => console.error('[studio]', e.mensagem) })
    document.title = 'Polaris Studio'
  } catch (e) { raiz.textContent = `Não foi possível iniciar o Studio: ${(e as Error).message}` }
}
// no celular a lateral fica atrás do botão (caixa de marcar do `nav/alternador`, sem JS): escolher um item a recolhe (o roteador do site faz o mesmo nas páginas do tenant; o Studio não carrega o roteador)
document.addEventListener('click', (e) => {
  const alvo = e.target as Element | null, lateral = alvo?.closest?.('aside[data-lateral]'); if (!lateral || !alvo!.closest('button, a[href]')) return
  const caixa = lateral.querySelector<HTMLInputElement>(':scope > input[data-alternador]'); if (caixa) caixa.checked = false
})
// Teclado das paletas (barra de ferramentas + lista): setas entre categorias e entre itens, Baixo abre/entra na lista, Esc fecha e volta à categoria. O resto (Enter, Espaço, Tab) é dos botões nativos.
const BARRA = '[role=toolbar][aria-label^="Paleta de"]', LISTA = '[role=group][aria-label$=" da categoria"]' // as paletas do Studio: de blocos, de campos e de elementos (esta sem lista)
const itensDaLista = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(`${LISTA} button`)]
const categoriaAberta = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`${BARRA} button[aria-current]`)
function focaPrimeiroItem(tentativas = 12): void { const it = itensDaLista(); if (it.length) it[0]!.focus(); else if (tentativas > 0) requestAnimationFrame(() => focaPrimeiroItem(tentativas - 1)) }
document.addEventListener('keydown', (e) => {
  const alvo = e.target as HTMLElement | null; if (!alvo || e.altKey || e.ctrlKey || e.metaKey) return
  const barra = alvo.closest(BARRA), lista = alvo.closest(LISTA)
  if (barra && alvo.tagName === 'BUTTON') {
    const cats = [...barra.querySelectorAll<HTMLButtonElement>('button')], i = cats.indexOf(alvo as HTMLButtonElement)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); cats[(i + (e.key === 'ArrowRight' ? 1 : -1) + cats.length) % cats.length]!.focus() }
    else if (e.key === 'ArrowDown' && /blocos|campos/.test(barra.getAttribute('aria-label') ?? '')) { e.preventDefault(); if (alvo.getAttribute('aria-current') === 'true') focaPrimeiroItem(); else { (alvo as HTMLButtonElement).click(); focaPrimeiroItem() } }
    else if (e.key === 'Escape') { const aberta = categoriaAberta(); if (aberta) { e.preventDefault(); aberta.click(); aberta.focus() } }
  } else if (barra && alvo.tagName === 'INPUT') {
    if (e.key === 'ArrowDown' && itensDaLista().length) { e.preventDefault(); itensDaLista()[0]!.focus() }
    else if (e.key === 'Escape' && (alvo as HTMLInputElement).value) { e.preventDefault(); (alvo as HTMLInputElement).value = ''; alvo.dispatchEvent(new Event('input', { bubbles: true })) }
  } else if (lista && alvo.tagName === 'BUTTON') {
    const it = itensDaLista(), i = it.indexOf(alvo as HTMLButtonElement)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); it[(i + 1) % it.length]!.focus() }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); if (i === 0 && e.key === 'ArrowUp') (categoriaAberta() ?? document.querySelector<HTMLElement>(`${BARRA} input`))?.focus(); else it[(i - 1 + it.length) % it.length]!.focus() }
    else if (e.key === 'Home') { e.preventDefault(); it[0]!.focus() } else if (e.key === 'End') { e.preventDefault(); it[it.length - 1]!.focus() }
    else if (e.key === 'Escape') { const aberta = categoriaAberta(); if (aberta) { e.preventDefault(); aberta.click(); aberta.focus() } else { const b = document.querySelector<HTMLInputElement>(`${BARRA} input`); if (b) { e.preventDefault(); b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); b.focus() } } }
  }
})
// Teclado da ÁRVORE DE BLOCOS: ↑/↓ andam entre os blocos (os botões de seleção são os "secundario" do grupo), → expande (ou desce ao próximo) e ← recolhe; Home/End vão ao primeiro e ao último. Enter e Espaço selecionam (botão nativo).
const ARVORE = '[aria-label="Árvore de blocos"]'
document.addEventListener('keydown', (e) => {
  const alvo = e.target as HTMLElement | null; if (!alvo || e.altKey || e.ctrlKey || e.metaKey || alvo.tagName !== 'BUTTON' || alvo.getAttribute('data-variante') !== 'secundario') return
  const arv = alvo.closest(ARVORE); if (!arv) return
  const itens = [...arv.querySelectorAll<HTMLButtonElement>('button[data-variante=secundario]')], i = itens.indexOf(alvo as HTMLButtonElement), seta = alvo.previousElementSibling as HTMLElement | null
  const vai = (k: number) => { e.preventDefault(); itens[Math.max(0, Math.min(itens.length - 1, k))]!.focus() }
  if (e.key === 'ArrowDown') vai(i + 1); else if (e.key === 'ArrowUp') vai(i - 1); else if (e.key === 'Home') vai(0); else if (e.key === 'End') vai(itens.length - 1)
  else if (e.key === 'ArrowRight') { if (seta?.getAttribute('aria-expanded') === 'false') { e.preventDefault(); seta.click() } else vai(i + 1) }
  else if (e.key === 'ArrowLeft') {
    if (seta?.getAttribute('aria-expanded') === 'true') { e.preventDefault(); seta.click() }
    else { // recolhido ou folha: sobe ao pai (a linha anterior com menos recuo; o recuo são os espaços largos do começo do rótulo da seta)
      const recuo = (b: Element) => ((b.previousElementSibling?.textContent ?? '').match(/^\u2003*/)?.[0].length ?? 0)
      for (let k = i - 1; k >= 0; k--) if (recuo(itens[k]!) < recuo(alvo)) { e.preventDefault(); itens[k]!.focus(); break }
    }
  }
})
// Atalhos do editor (fora de campos de texto, onde o desfazer é do próprio campo): Ctrl+Z desfaz, Ctrl+Shift+Z ou Ctrl+Y refaz, Ctrl+S salva, Delete remove o bloco da linha da árvore em foco. Clicam nos mesmos botões da barra, então valem as mesmas regras (botão ausente = nada acontece).
const clicaBotao = (nome: string): boolean => { const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim() === nome && !x.disabled); b?.click(); return !!b }
document.addEventListener('keydown', (e) => {
  const alvo = e.target as HTMLElement | null, emCampo = !!alvo?.closest('input, textarea, select, [contenteditable=""], [contenteditable=true]')
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (k === 's') { e.preventDefault(); clicaBotao('Salvar'); return }
    if (emCampo) return
    if (k === 'z' && !e.shiftKey) { if (clicaBotao('Desfazer')) e.preventDefault() } else if ((k === 'z' && e.shiftKey) || k === 'y') { if (clicaBotao('Refazer')) e.preventDefault() }
  } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && /^(Identificador do novo nó|Rota da nova página)$/.test(alvo?.getAttribute('aria-label') ?? '')) {
    e.preventDefault(); clicaBotao('Criar') || clicaBotao('Descartar e criar') // Enter no formulário de criar envia (o botão só existe quando o identificador é válido)
  } else if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.metaKey && !emCampo && alvo?.closest(ARVORE) && alvo.getAttribute('data-variante') === 'secundario' && alvo.hasAttribute('aria-current')) {
    const linha = alvo.parentElement, rem = linha && [...linha.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim() === 'Remover'); if (rem) { e.preventDefault(); rem.click() }
  }
})
// Semântica de ÁRVORE para leitores de tela: o contêiner vira `tree`; cada linha, `treeitem` com nível, estado expandido e selecionado; setas e marcadores (só visuais) saem da leitura; só um item fica na ordem do Tab (o ativo) e as setas do teclado movem o foco. Reaplica a cada mudança da árvore (o runtime redesenha as linhas).
function aplicaArvore(): void {
  const arv = document.querySelector<HTMLElement>(ARVORE); if (!arv) return
  arv.setAttribute('role', 'tree'); arv.setAttribute('aria-orientation', 'vertical')
  const linhas = [...arv.querySelectorAll<HTMLElement>(':scope > div > div')], itens: HTMLButtonElement[] = []
  for (const l of linhas) {
    const bs = [...l.querySelectorAll<HTMLButtonElement>(':scope > button')], sel = bs.find((b) => b.getAttribute('data-variante') === 'secundario'); if (!sel) continue
    const seta = sel.previousElementSibling as HTMLElement | null, nivel = ((seta?.textContent ?? '').match(/^\u2003*/)?.[0].length ?? 0) + 1
    l.setAttribute('role', 'treeitem'); l.setAttribute('aria-level', String(nivel)); l.setAttribute('aria-label', (sel.textContent ?? '').trim())
    l.setAttribute('aria-selected', sel.hasAttribute('aria-current') ? 'true' : 'false')
    const ex = seta?.getAttribute('aria-expanded'); if (ex) l.setAttribute('aria-expanded', ex); else l.removeAttribute('aria-expanded')
    if (seta) { seta.setAttribute('aria-hidden', 'true'); seta.tabIndex = -1 }
    itens.push(sel)
  }
  const ativo = itens.find((b) => b.hasAttribute('aria-current')) ?? itens[0]; for (const b of itens) b.tabIndex = b === ativo ? 0 : -1
}
let agendado = 0
new MutationObserver(() => { cancelAnimationFrame(agendado); agendado = requestAnimationFrame(aplicaArvore) }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-expanded'] })
// "Pular para o conteúdo": o primeiro Tab leva a este link (só aparece com o foco) e ele leva ao <main id="principal">
const pular = document.createElement('a'); pular.href = '#principal'; pular.textContent = 'Pular para o conteúdo'; pular.className = 'pular'
pular.addEventListener('click', (e) => { const m = document.getElementById('principal'); if (m) { e.preventDefault(); m.setAttribute('tabindex', '-1'); m.focus() } })
document.body.prepend(pular)
void inicia()
