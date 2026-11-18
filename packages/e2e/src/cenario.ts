import type { Browser } from 'playwright-core'
import type { Cenario, Site } from './site'
import { conteudo, coletor, corpoDaPagina, interage, lintA11y, overflowHorizontal } from './verificacoes'

/** Tudo que se exige de UMA página gerada de um exemplo de bloco. Devolve os problemas (vazio = a página está boa). */
export async function verificaCenario(nav: Browser, site: Site, c: Cenario): Promise<string[]> {
  const ach: string[] = []
  // 1) o que o SERVIDOR entrega, sem nenhum JavaScript
  const c0 = await nav.newContext({ viewport: { width: 1024, height: 768 }, javaScriptEnabled: false }); const sem = await c0.newPage()
  const r0 = await sem.goto(site.url + c.rota); if (r0?.status() !== 200) ach.push(`HTTP ${r0?.status()} ao abrir a página`)
  const htmlServidor = await corpoDaPagina(sem); await c0.close()
  // 2) a página de verdade: sem erro de console/exceção/requisição/CSP, com conteúdo e acessível
  const c1 = await nav.newContext({ viewport: { width: 1024, height: 768 } }); const pg = await c1.newPage(); const problemas = coletor(pg)
  await pg.goto(site.url + c.rota, { waitUntil: 'networkidle' })
  ach.push(...problemas, ...(await conteudo(pg)), ...(await lintA11y(pg)))
  // 3) hidratação: a página que o JavaScript montou é IGUAL à que o servidor entregou; interativa: clica e digita sem quebrar. Estática: o DOM não muda sozinho
  if (c.interativo) { await pg.waitForFunction(() => !!(window as unknown as { Polaris?: unknown }).Polaris, undefined, { timeout: 5000 }).catch(() => ach.push('o runtime (Polaris) não carregou')); const h = await corpoDaPagina(pg); if (h !== htmlServidor) ach.push(`HIDRATAÇÃO divergiu do HTML do servidor (${htmlServidor.length} → ${h.length} bytes)`); ach.push(...(await interage(pg))) }
  else if ((await corpoDaPagina(pg)) !== htmlServidor) ach.push('página estática mudou depois de carregar')
  // 4) celular (360 px) e modo escuro
  await pg.setViewportSize({ width: 360, height: 640 }); ach.push(...(await overflowHorizontal(pg)))
  await pg.emulateMedia({ colorScheme: 'dark' }); await pg.reload({ waitUntil: 'networkidle' }); ach.push(...(await conteudo(pg)))
  await c1.close()
  return [...new Set(ach)]
}
