import { existsSync } from 'node:fs'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaSite, type Site } from '../src/site'
import { verificaCenario } from '../src/cenario'

// E2E a partir dos SCHEMAS: cada exemplo de bloco é uma página real, construída pelo AOT, servida com CSP estrita e aberta em Chrome de verdade.
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
let site: Site, nav: Browser
beforeAll(async () => { if (!CHROME) return; site = await criaSite(); nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }) })
afterAll(async () => { await nav?.close(); await site?.fecha() })

describe.skipIf(!CHROME)('os exemplos dos blocos, no navegador', () => {
  it('há cenário para TODOS os exemplos do catálogo (o que o catálogo documenta é o que o E2E exercita)', () => { expect(site.cenarios.length).toBe(95); expect(new Set(site.cenarios.map((c) => c.interface)).size).toBeGreaterThanOrEqual(30); expect(site.cenarios.some((c) => c.modo === 'vivo')).toBe(true); expect(site.cenarios.some((c) => c.modo === 'estatico')).toBe(true) })

  // os cenários são GERADOS do registry: um `it` por exemplo, com o nome do bloco e do exemplo
  it('cada exemplo de cada bloco passa em TODAS as verificações (console limpo, CSP estrita, hidratação igual ao servidor, acessível, sem overflow no celular, modo escuro)', async () => {
    const falhas: string[] = []
    for (const c of site.cenarios) { const ach = await verificaCenario(nav, site, c); if (ach.length) falhas.push(`${c.interface} › ${c.titulo}: ${ach.join(' | ')}`) }
    expect(falhas).toEqual([])
  })
})
