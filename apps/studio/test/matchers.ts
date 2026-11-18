import type { Locator } from 'playwright-core'
import { expect } from 'vitest'

// Matchers assíncronos com repetição (como os do @playwright/test): esperam até 5 s a condição valer. Só o necessário para o E2E do Studio.
async function espera(ver: () => Promise<{ ok: boolean; obtido: unknown }>, ms = 5000): Promise<{ ok: boolean; obtido: unknown }> {
  const fim = Date.now() + ms; let r = { ok: false, obtido: undefined as unknown }
  for (;;) { try { r = await ver() } catch (e) { r = { ok: false, obtido: (e as Error).message } } if (r.ok || Date.now() > fim) return r; await new Promise((x) => setTimeout(x, 50)) }
}
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
const resultado = (r: { ok: boolean; obtido: unknown }, nome: string, esperado: unknown) => ({ pass: r.ok, message: () => `${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(r.obtido)}` })
expect.extend({
  async toHaveText(l: Locator, t: string | RegExp) { const r = await espera(async () => { const o = norm(await l.first().textContent({ timeout: 1000 })); return { ok: t instanceof RegExp ? t.test(o) : o === t, obtido: o } }); return resultado(r, 'toHaveText', String(t)) },
  async toContainText(l: Locator, t: string | RegExp) { const r = await espera(async () => { const o = norm(await l.first().textContent({ timeout: 1000 })); return { ok: t instanceof RegExp ? t.test(o) : o.includes(t), obtido: o } }); return resultado(r, 'toContainText', String(t)) },
  async toBeVisible(l: Locator) { const r = await espera(async () => ({ ok: await l.first().isVisible(), obtido: 'invisível' })); return resultado(r, 'toBeVisible', true) },
  async toBeDisabled(l: Locator) { const r = await espera(async () => ({ ok: await l.first().isDisabled(), obtido: 'habilitado' })); return resultado(r, 'toBeDisabled', true) },
  async toHaveAttribute(l: Locator, n: string, v: string) { const r = await espera(async () => { const o = await l.first().getAttribute(n, { timeout: 1000 }); return { ok: o === v, obtido: o } }); return resultado(r, `toHaveAttribute(${n})`, v) },
  async toHaveValue(l: Locator, v: string) { const r = await espera(async () => { const o = await l.first().inputValue({ timeout: 1000 }); return { ok: o === v, obtido: o } }); return resultado(r, 'toHaveValue', v) },
  async toHaveCount(l: Locator, n: number) { const r = await espera(async () => { const o = await l.count(); return { ok: o === n, obtido: o } }); return resultado(r, 'toHaveCount', n) },
})
declare module 'vitest' { interface Assertion<T> { toHaveText(t: string | RegExp): Promise<void>; toContainText(t: string | RegExp): Promise<void>; toBeVisible(): Promise<void>; toBeDisabled(): Promise<void>; toHaveAttribute(n: string, v: string): Promise<void>; toHaveValue(v: string): Promise<void>; toHaveCount(n: number): Promise<void> }
  interface AsymmetricMatchersContaining { toHaveText(t: string | RegExp): void } }
