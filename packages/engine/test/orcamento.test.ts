import { Registry } from '@polaris/schema'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compilaHtmlVivo, compilaPrograma, registraBase } from '../src/index'
import { empacotaCliente } from '../src/aot/index'

// Orçamento de performance (orcamento.json). Estourar = falha no CI; para subir um limite, justifique no PR e no docs/desempenho.md.
const orc = JSON.parse(readFileSync(new URL('../orcamento.json', import.meta.url), 'utf8'))
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const est = { n: { tipo: 'inteiro', inicial: 0 }, itens: { tipo: 'json', inicial: [] } }
const reg = () => { const r = new Registry(); registraBase(r); r.registra(no('bloco', 'x.cod', { interface: 'x/cod', props: { type: 'object', properties: {} }, codigo: { linguagem: 'js', fonte: 'function render(){ return { tag: "p", children: ["x"] } }' } })); return r }
let n = 0
const prog = (raiz: object, extra: object = {}) => { const r = reg(); const c = compilaPrograma(r, r.registra(no('pagina', `o${n++}`, { rota: '/', raiz, ...extra }))); if (!c.ok) throw new Error(JSON.stringify(c.erros)); return c.programa }

const PAGINAS: Record<string, () => ReturnType<typeof prog>> = {
  'estatica-simples': () => prog(P('texto/paragrafo', { props: { texto: 'oi' } })),
  contador: () => prog(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'n={estado.n}' } }), P('nav/botao', { props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } })] } }), { estado: est }),
  'lista-formatos': () => prog(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { repetir: { cada: 'ordena(filtra(estado.itens, p => p.ok), p => p.nome)', como: 'p', chave: 'p.id' }, props: { texto: '{p.nome | maiusculas}: {p.preco | brl}' } })] } }), { estado: est }),
  'dinheiro-exato': () => prog(P('texto/paragrafo', { props: { texto: '{qbrl(qmul(estado.n, "1.1"))}' } }), { estado: est }),
  'com-bloco-de-codigo': () => prog(P('x/cod')),
}

describe('orçamento de bundle do cliente (gz, por página)', () => {
  for (const [nome, limite] of Object.entries<number>(orc.bundle_gz_bytes)) {
    it(`${nome} ≤ ${limite} B`, async () => {
      const r = await empacotaCliente(PAGINAS[nome]!())
      if (!r.ok) throw new Error(JSON.stringify(r.motivos))
      expect(r.pacote.gz, `${nome}: ${r.pacote.gz} B gz`).toBeLessThanOrEqual(limite)
    })
  }
})

describe('orçamento de SSR do runtime vivo', () => {
  it(`HTML de 900 cartões (mediana) ≤ ${orc.ssr_vivo_ms.lista_900_cartoes_mediana} ms`, () => {
    const r = reg()
    r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { nome: { type: 'string' }, preco: { type: 'number' } } }, modelo: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: '{props.nome}', nivel: 3 } }), P('texto/paragrafo', { props: { texto: '{props.preco | brl}' } })] } }) }))
    const c = compilaPrograma(r, r.registra(no('pagina', 'ssr900', { rota: '/', estado: { itens: { tipo: 'json', inicial: [] } }, raiz: P('layout/pilha', { slots: { filhos: [P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { nome: '{p.nome}', preco: '{p.preco}' } })] } }) })))
    if (!c.ok) throw new Error('x')
    const h = compilaHtmlVivo(c.programa); if (!h.ok) throw new Error('x')
    const itens = Array.from({ length: 900 }, (_, i) => ({ id: i, nome: `Produto ${i}`, preco: 10 + i * 1.5 }))
    const t: number[] = []
    for (let i = 0; i < 12; i++) { const a = performance.now(); h.pagina.render({ estado: { itens } }); t.push(performance.now() - a) }
    t.sort((x, y) => x - y)
    expect(t[6]!, `mediana ${t[6]!.toFixed(1)} ms`).toBeLessThanOrEqual(orc.ssr_vivo_ms.lista_900_cartoes_mediana)
  })
})
