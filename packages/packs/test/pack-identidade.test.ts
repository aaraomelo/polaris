import { it, expect } from 'vitest'
import { Registry, validaFormulario } from '@polaris/schema'
import { registraBase, compilaPrograma } from '@polaris/engine'
import { nosDoPack } from '../src/index'
it('pack identidade registra, compila e valida', () => {
  const r = new Registry(); registraBase(r); for (const n of nosDoPack('identidade')) r.registra(n)
  const problemas: string[] = []
  for (const id of ['identidade.entrar', 'identidade.esqueci', 'identidade.redefinir']) { const f = r.resolve('formulario', id)!.no; problemas.push(...r.verifica(f).map((e) => e.mensagem), ...validaFormulario(r, f).map((e) => e.mensagem)); const p = r.resolve('pagina', id)!.no; const c = compilaPrograma(r, p, {}); if (!c.ok) problemas.push(JSON.stringify(c.erros[0])) }
  expect(problemas).toEqual([])
})
