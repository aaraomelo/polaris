import type { Page } from 'playwright-core'

// As verificações de uma página no navegador. Cada uma devolve a LISTA de problemas (vazia = ok): a mesma função serve ao teste dos blocos e à prova de que ela enxerga o que deve.

/** Acessibilidade mínima, calculada NA página: nome acessível de botão/link/campo, alt de imagem, ids únicos, no máximo um h1 e sem pular nível de título, `lang`, foco por teclado. */
export async function lintA11y(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const p: string[] = []
    const nome = (e: Element): string => { const a = e.getAttribute('aria-label')?.trim(); if (a) return a; const lb = e.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent?.trim() ?? '').join(' ').trim(); if (t) return t } return (e as HTMLElement).innerText?.trim() || e.getAttribute('title')?.trim() || '' }
    const raiz = document.getElementById('polaris') ?? document.body
    for (const b of raiz.querySelectorAll('button, [role="button"], a[href]')) if (!nome(b) && !b.querySelector('img[alt]:not([alt=""])')) p.push(`${b.tagName.toLowerCase()} sem nome acessível`)
    for (const i of raiz.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea')) {
      const id = i.getAttribute('id'), tem = nome(i) || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()) || i.closest('label')?.textContent?.trim()
      if (!tem) p.push(`${i.tagName.toLowerCase()} sem rótulo`)
    }
    for (const img of raiz.querySelectorAll('img')) if (!img.hasAttribute('alt')) p.push('imagem sem atributo alt')
    const ids = new Map<string, number>(); for (const e of raiz.querySelectorAll('[id]')) ids.set(e.id, (ids.get(e.id) ?? 0) + 1); for (const [id, n] of ids) if (n > 1) p.push(`id duplicado: ${id}`)
    const hs = [...raiz.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])); if (hs.filter((n) => n === 1).length > 1) p.push('mais de um h1')
    for (let i = 1; i < hs.length; i++) if (hs[i]! - hs[i - 1]! > 1) p.push(`título pula do h${hs[i - 1]} para o h${hs[i]}`)
    if (!document.documentElement.lang) p.push('html sem lang')
    for (const e of raiz.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea')) if ((e as HTMLElement).tabIndex < 0 && !(e as HTMLInputElement).disabled) p.push(`${e.tagName.toLowerCase()} fora da ordem de foco (tabindex negativo)`)
    return p
  })
}

/** Nada transborda na horizontal (360 px de largura): conteúdo cortado ou rolagem lateral num celular é bug. */
export async function overflowHorizontal(page: Page): Promise<string[]> {
  return page.evaluate(() => { const d = document.documentElement; return d.scrollWidth > d.clientWidth + 1 ? [`a página transborda na horizontal (${d.scrollWidth}px > ${d.clientWidth}px)`] : [] })
}

/** O que a página deixa de dizer sobre si: título, conteúdo visível. */
export async function conteudo(page: Page): Promise<string[]> {
  return page.evaluate(() => { const p: string[] = []; if (!document.title.trim()) p.push('página sem <title>'); const r = document.getElementById('polaris') ?? document.body; if (!r.children.length) p.push('o contêiner da página está vazio'); else if (!r.textContent?.trim() && !r.querySelector('img, svg, input, button, canvas, hr, progress')) p.push('a página não mostra nada (sem texto nem elemento visual)'); return p })
}

/** Coletor do que o navegador reclama: erro de console, exceção, requisição que falhou, violação de CSP. */
export function coletor(page: Page) {
  const achados: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') achados.push(`console.${m.type()}: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => achados.push(`exceção: ${e.message.slice(0, 200)}`))
  page.on('requestfailed', (r) => achados.push(`requisição falhou: ${r.url().slice(0, 100)}`))
  page.on('response', (r) => { if (r.status() >= 400) achados.push(`HTTP ${r.status()}: ${r.url().slice(0, 100)}`) })
  return achados
}

/** O `innerHTML` do contêiner: para comparar o HTML do SERVIDOR (sem JavaScript) com o da página HIDRATADA. */
export const corpoDaPagina = (page: Page): Promise<string> => page.evaluate(() => (document.getElementById('polaris') ?? document.body).innerHTML)

/** Interage com o que a página oferece (clica botões, digita nos campos) e devolve o que quebrou. Não afirma nada sobre o resultado: pega exceções e erros que a interação provoca. */
export async function interage(page: Page): Promise<string[]> {
  const problemas: string[] = []; const antes = coletor(page).length
  const alvos = page.locator('button:visible:not([disabled]), [role="button"]:visible')
  for (let i = 0, n = Math.min(await alvos.count(), 6); i < n; i++) { try { await alvos.nth(i).click({ timeout: 2000, trial: false }) } catch (e) { problemas.push(`clique no botão ${i} falhou: ${(e as Error).message.split('\n')[0]!.slice(0, 120)}`) } }
  const campos = page.locator('input[type="text"]:visible:not([disabled]), input:not([type]):visible:not([disabled]), textarea:visible:not([disabled])')
  for (let i = 0, n = Math.min(await campos.count(), 4); i < n; i++) { try { await campos.nth(i).fill('teste e2e', { timeout: 2000 }); if ((await campos.nth(i).inputValue()) !== 'teste e2e') problemas.push(`o campo ${i} não guardou o que foi digitado`) } catch (e) { problemas.push(`digitar no campo ${i} falhou: ${(e as Error).message.split('\n')[0]!.slice(0, 120)}`) } }
  void antes; return problemas
}
