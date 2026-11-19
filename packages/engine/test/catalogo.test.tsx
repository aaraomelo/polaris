// @vitest-environment jsdom
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry } from '@polaris/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { geraCatalogo, descreveTipo } from '../src/catalogo/index'
import { escreveCatalogo } from '../src/catalogo/escreve'
import { registraBase, compilaHtmlVivo, compilaPrograma } from '../src/index'
import { registraTemas, TEMA_PADRAO } from '../src/tema/index'
import { BLOCOS_BASE } from '../src/render/base'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const reg = (extra: object[] = []) => { const r = new Registry(); registraBase(r); registraTemas(r); for (const n of extra) r.registra(n); return r }
const raiz = mkdtempSync(join(tmpdir(), 'polaris-cat-'))
afterAll(() => rmSync(raiz, { recursive: true, force: true }))

describe('catálogo gerado do registry', () => {
  const c = geraCatalogo(reg(), { tema: TEMA_PADRAO })
  it('documenta TODO bloco base (título, descrição, ao menos um exemplo) e nenhum exemplo é inválido', () => {
    expect(c.erros).toEqual([])
    expect(c.blocos).toBe(BLOCOS_BASE.length + 1) // + core/slot
    for (const b of BLOCOS_BASE as any[]) {
      expect(typeof b.spec.titulo, b.spec.interface).toBe('string'); expect(b.spec.descricao.length, b.spec.interface).toBeGreaterThan(15); expect(b.spec.exemplos.length, b.spec.interface).toBeGreaterThan(0)
      expect(c.html.claro, b.spec.interface).toContain(`id="${b.spec.interface.replace('/', '-')}"`)
    }
    expect(c.exemplos).toBeGreaterThanOrEqual(30)
  })
  it('props, slots e eventos vêm do schema (tipos, limites, padrão, obrigatória, aceita, payload)', () => {
    expect(c.markdown).toMatch(/\| `colunas` \| inteiro ≥ 1 ≤ 12 \| não \| 2 \|/)
    expect(c.markdown).toMatch(/\| `texto` \| texto \| sim \|/)                  // obrigatória
    expect(c.markdown).toMatch(/\| `tom` \| "neutro" \| "sucesso" \| "alerta" \| "erro"|\\\| "sucesso"/) // enum, com o | escapado
    expect(c.markdown).toMatch(/\| `filhos` \| tabela\/celula \|/)               // slot que só aceita célula
    expect(c.markdown).toMatch(/\| `aoMudar` \| decimal \|/); expect(c.markdown).toMatch(/\| `aoMudar` \| booleano \|/)
    expect(c.html.claro).toContain('<td><code>colunas</code></td>')
  })
  it('o preview é o HTML que o runtime produz para o exemplo (não uma imagem nem uma cópia)', () => {
    const r = reg(); const inst = { bloco: 'layout/grade', props: { colunas: 3, gap: 12 }, slots: { filhos: ['1', '2', '3', '4', '5'].map((t) => ({ bloco: 'texto/paragrafo', props: { texto: t } })) } }
    const p = compilaPrograma(r, no('pagina', 'x', { rota: '/', raiz: inst }))
    if (!p.ok) throw new Error('x'); const h = compilaHtmlVivo(p.programa); if (!h.ok) throw new Error('y')
    expect(c.html.claro).toContain(`<div class="cat-previa">${h.pagina.render({}).corpo}</div>`)
  })
  it('claro e escuro são o mesmo corpo; só muda data-modo; saída determinística', () => {
    expect(c.html.escuro.replace(' data-modo="escuro"', '')).toBe(c.html.claro)
    expect(geraCatalogo(reg(), { tema: TEMA_PADRAO }).markdown).toBe(c.markdown)
  })
  it('mostra o tema com amostras de cor e o resultado da auditoria AA', () => {
    expect(c.html.claro).toContain('Todos os pares críticos passam AA')
    expect(c.html.claro).toContain('<span class="cat-amostra" style="background:#2D3A4F"></span>')
    expect(c.html.claro).toContain('Modo escuro')
  })
})

describe('herança, override e robustez', () => {
  it('extends: mostra a cadeia e as props herdadas + próprias; override do tenant vence só para ele', () => {
    const extras = [
      no('bloco', 'x.aviso', { interface: 'x/aviso', extends: 'texto/paragrafo', titulo: 'Aviso', descricao: 'Parágrafo com urgência.', props: { type: 'object', properties: { urgente: { type: 'boolean' } } }, exemplos: [{ titulo: 'Urgente', instancia: { bloco: 'x/aviso', props: { texto: 'Atenção', urgente: true } } }] }),
      no('bloco', 'x.aviso', { interface: 'x/aviso', extends: 'texto/paragrafo', titulo: 'Aviso do tenant', descricao: 'Versão da Acme.' }, { tenantId: 'acme' }),
    ]
    const base = geraCatalogo(reg(extras)), acme = geraCatalogo(reg(extras), { contexto: { tenantId: 'acme' } })
    expect(base.markdown).toContain('### Aviso (`x/aviso`)'); expect(base.markdown).toContain('Herda de: `texto/paragrafo`')
    expect(base.markdown).toMatch(/\| `urgente` \| booleano \|/); expect(base.markdown).toMatch(/\| `texto` \| texto \| sim \|/) // herdada
    expect(acme.markdown).toContain('### Aviso do tenant'); expect(base.markdown).not.toContain('Aviso do tenant')
    expect(base.erros).toEqual([])
  })
  it('exemplo inválido vira erro visível (role=alert) e NÃO derruba o catálogo nem os demais exemplos', () => {
    const c = geraCatalogo(reg([no('bloco', 'x.ruim', { interface: 'x/ruim', titulo: 'Ruim', descricao: 'Com exemplo quebrado.', exemplos: [
      { titulo: 'prop errada', instancia: { bloco: 'layout/grade', props: { colunas: 99 } } },
      { titulo: 'bloco inexistente', instancia: { bloco: 'nao/existe' } },
      { titulo: 'bom', instancia: { bloco: 'texto/paragrafo', props: { texto: 'ok' } } },
    ] })]))
    expect(c.erros.length).toBe(2); expect(c.erros[0]).toContain('x/ruim › prop errada'); expect(c.erros[1]).toContain('bloco inexistente')
    expect(c.html.claro).toContain('Exemplo inválido'); expect(c.html.claro).toContain('<div class="cat-previa"><p>ok</p></div>')
    expect(c.blocos).toBe(BLOCOS_BASE.length + 2)
  })
  it('tudo que vem do nó é escapado (título, descrição, nome da prop, texto do exemplo, JSON do exemplo, id do tema)', () => {
    const t = { ...TEMA_PADRAO, id: 'tema"><script>x</script>' } as any
    const c = geraCatalogo(reg([no('bloco', 'x.xss', { interface: 'x/xss', titulo: '<img src=x onerror=alert(1)>', descricao: '<script>alert(1)</script>', props: { type: 'object', properties: { '<b>p</b>': { type: 'string', description: '"><svg onload=1>' } } }, exemplos: [{ titulo: '<i>t</i>', instancia: { bloco: 'texto/paragrafo', props: { texto: '</script><script>alert(2)</script>' } } }] })]), { tema: t })
    for (const h of [c.html.claro, c.html.escuro]) {
      const d = new DOMParser().parseFromString(h, 'text/html')
      expect(d.querySelectorAll('script').length).toBe(0); expect(d.querySelector('img[onerror], svg[onload]')).toBeNull()
      expect(d.body.textContent).toContain('<script>alert(1)</script>') // aparece como TEXTO
    }
  })
})

describe('descreveTipo', () => {
  it.each([[{ type: 'string' }, 'texto'], [{ type: 'integer', minimum: 1, maximum: 12 }, 'inteiro ≥ 1 ≤ 12'], [{ enum: ['a', 1] }, '"a" | 1'], [{ type: ['number', 'string'] }, 'número | texto'], [{}, 'qualquer'], [undefined, 'qualquer']])('%j → %s', (s, e) => { expect(descreveTipo(s)).toBe(e) })
})

describe('escreveCatalogo: arquivos', () => {
  it('escreve HTML claro/escuro, CSS do catálogo, CSS do tema (hash), Markdown e a imagem de exemplo; o link do tema aponta para um arquivo que existe', () => {
    const dir = join(raiz, 'saida')
    const r = escreveCatalogo(reg(), dir, { tema: TEMA_PADRAO })
    const nomes = readdirSync(dir).sort()
    expect(nomes.filter((n) => !n.startsWith('tema.'))).toEqual(['catalogo.css', 'catalogo.md', 'escuro.html', 'exemplos', 'index.html'])
    expect(nomes.filter((n) => /^tema\.[0-9a-f]{12}\.css$/.test(n)).length).toBe(1)
    const tema = r.arquivos.find((a) => a.startsWith('tema.'))!
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain(`<link rel="stylesheet" href="${tema}">`)
    expect(existsSync(join(dir, 'exemplos', 'produto.svg'))).toBe(true)
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('src="exemplos/produto.svg"') // o exemplo da imagem aponta para ele
  })
})
