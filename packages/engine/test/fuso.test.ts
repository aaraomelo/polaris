import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FUSOS = ['UTC', 'Asia/Tokyo', 'Pacific/Pago_Pago', 'America/Sao_Paulo', 'Pacific/Kiritimati']

function roda(tz: string): { host: { h: number; tz: number; s: string }; sandbox: string } {
  // vite-node vem como dependência do vitest: resolve a partir dele
  const req = createRequire(join(__dirname, 'x.js'))
  const doVitest = createRequire(req.resolve('vitest/package.json'))
  const viteNode = join(dirname(doVitest.resolve('vite-node/package.json')), 'vite-node.mjs')
  const out = execFileSync(process.execPath, [viteNode, join(__dirname, 'helpers', 'tz.ts')], { env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 60_000 })
  return JSON.parse(out.trim().split('\n').pop()!)
}

describe('determinismo entre fusos horários (servidor e cliente em fusos diferentes)', () => {
  const resultados = Object.fromEntries(FUSOS.map((tz) => [tz, roda(tz)]))

  it('controle: o Date NATIVO do host muda com o fuso (o teste é capaz de detectar o problema)', () => {
    const horas = new Set(FUSOS.map((tz) => resultados[tz]!.host.h))
    expect(horas.size).toBeGreaterThan(3)
    expect(new Set(FUSOS.map((tz) => resultados[tz]!.host.s)).size).toBeGreaterThan(3)
  })

  it('o sandbox devolve a MESMA saída em todos os fusos, byte a byte', () => {
    const saidas = new Set(FUSOS.map((tz) => resultados[tz]!.sandbox))
    expect([...saidas]).toHaveLength(1)
    expect(JSON.parse([...saidas][0]!)).toMatchObject({ h: 23, dia: 15, tz: 0, s: '2020-06-15T23:30:45.000Z', p: '2020-06-15T23:30:45.000Z', tl: '2020-06-15 23:30:45' })
  })
})
