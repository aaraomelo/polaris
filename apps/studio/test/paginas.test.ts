import { readFileSync } from 'node:fs'
import { compilaPrograma, registraBase, renderPaginaHtml, COMPONENTES_BASE } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { registroDaPlataforma } from '@polaris/packs'
import { describe, expect, it } from 'vitest'
import { SAIDA, conteudo } from '../scripts/gera-paginas'

const reg = registroDaPlataforma(); registraBase(reg); registraTemas(reg)
describe('as páginas do Studio (nós da plataforma)', () => {
  it('o JSON commitado é exatamente o gerado do DSL (rode `pnpm --filter @polaris/studio-app paginas`)', () => { expect(readFileSync(SAIDA, 'utf8')).toBe(conteudo()) })
  it('a página studio.app compila sem erro contra o registro da plataforma', () => {
    const no = reg.resolve('pagina', 'studio.app')!.no, r = compilaPrograma(reg, no)
    if (!r.ok) throw new Error(JSON.stringify(r.erros.slice(0, 5), null, 1))
    expect(r.ok).toBe(true)
  })
  it('renderiza no servidor (SSR) com dados de exemplo e o estado inicial vazio', () => {
    const r = compilaPrograma(reg, reg.resolve('pagina', 'studio.app')!.no); if (!r.ok) throw new Error('compila')
    const h = renderPaginaHtml({ programa: r.programa, componentes: COMPONENTES_BASE, dados: { nos: { nos: [{ kind: 'tema', id: 'meu', seq: 2 }], base: { tema: ['padrao'], pagina: [] } } } }).corpo
    expect(h).toContain('Polaris Studio'); expect(h).toContain('meu (personalizado)'); expect(h).toContain('padrao (padrão)'); expect(h).not.toContain('Tokens do tema')
  })
})
