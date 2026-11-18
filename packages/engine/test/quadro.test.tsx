// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml } from '../src/index'

const pagina = (props: object, bloco = 'midia/quadro') => { const r = new Registry(); registraBase(r); const c = compilaPrograma(r, r.registra({ kind: 'pagina', id: 'q', versao: '1.0.0', spec: { rota: '/', raiz: { bloco, id: 'b', props } } } as never)); if (!c.ok) throw new Error(JSON.stringify(c.erros)); return c.programa }

describe('midia/quadro: o sandbox é sempre vazio, em todos os caminhos de renderização', () => {
  const html = '<!doctype html><script>window.top.x=1</script><p onclick="a()">oi</p>'
  it('React, HTML estático e runtime vivo emitem `sandbox=""` (sem allow-*) e o conteúdo só em srcdoc', () => {
    const pg = pagina({ titulo: 'Prévia', html }), r = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo
    expect(r).toMatch(/<iframe[^>]*\ssandbox=""/); expect(r).not.toMatch(/allow-/); expect(r).not.toContain('<script>window.top'); expect(r).toContain('&lt;script&gt;')
    const v = compilaHtmlVivo(pg); if (!v.ok) throw new Error('vivo'); const corpo = v.pagina.render({}).corpo; expect(corpo).toMatch(/<iframe[^>]*\ssandbox=""/); expect(corpo).not.toMatch(/allow-/)
    const c = document.createElement('div'); document.body.appendChild(c); montaVivo({ programa: pg, container: c })
    const f = c.querySelector('iframe')!; expect(f.getAttribute('sandbox')).toBe(''); expect(f.getAttribute('srcdoc')).toBe(html); expect(f.getAttribute('referrerpolicy')).toBe('no-referrer')
  })
  it('nenhuma prop consegue abrir o sandbox; título é obrigatório; html acima do limite é recusado pelo schema', () => {
    expect(() => pagina({ titulo: 't', html: '', sandbox: 'allow-scripts allow-same-origin' } as never)).toThrow(/'sandbox' não existe/) // o schema nem aceita a prop
    expect(() => pagina({ html: 'x' })).toThrow(/titulo/); expect(() => pagina({ titulo: 't', html: 'x'.repeat(262145) })).toThrow(/maxLength|262144|must NOT have more/)
  })
})
