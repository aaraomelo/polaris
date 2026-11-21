import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, registraBase } from '../src/index'
import { empacotaCliente } from '../src/aot'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any

describe('bundle por página com bloco de código', () => {
  const r = new Registry(); registraBase(r)
  r.registra(no('bloco', 'x.l', { interface: 'x/l', props: { type: 'object', properties: {} }, codigo: { linguagem: 'js', fonte: 'function render(){ return { tag: "p", children: ["x"] } }' } }))
  const pg = (raiz: object) => { const c = compilaPrograma(r, r.registra(no('pagina', `a${Math.random()}`, { rota: '/', raiz }))); if (!c.ok) throw new Error('x'); return c.programa }
  it('leva o plugin só quando há código, sem React nem QuickJS (o sandbox é do chamador)', async () => {
    const com = await empacotaCliente(pg({ bloco: 'x/l' })), sem = await empacotaCliente(pg({ bloco: 'texto/paragrafo', props: { texto: 'a' } }))
    if (!com.ok || !sem.ok) throw new Error(JSON.stringify(com))
    expect(Object.keys(com.pacote.contribuicao)).toContain('vivo/codigo.ts')
    expect(Object.keys(sem.pacote.contribuicao)).not.toContain('vivo/codigo.ts')
    expect(com.pacote.codigo).not.toMatch(/react|quickjs/i)
    expect(Object.keys(com.pacote.contribuicao)).not.toContain("expr/funcoes.ts"); expect(com.pacote.gz).toBeLessThan(17.9 * 1024) // 17 → 17,2 KB (primitivas SVG, gaveta e `modo`); validação, emissores e allowlist de UI custam ~6 KB sobre o núcleo
  })
})
