// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type Programa } from '../src/index'
import { BLOCOS_COMMERCE, SERVICOS, registraCommerce } from '../src/commerce/index'
import { geraCatalogo } from '../src/catalogo/index'
import { registraTemas } from '../src/tema/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const novoReg = () => { const r = new Registry(); registraBase(r); registraTemas(r); registraCommerce(r); return r }
let n = 0
function pagina(raiz: object, extra: object = {}, r = novoReg()): Programa {
  const c = compilaPrograma(r, r.registra(no('pagina', `c${n++}`, { rota: '/', raiz, ...extra })))
  if (!c.ok) throw new Error(JSON.stringify(c.erros, null, 1))
  return c.programa
}
const P = (id: string, nome: string, preco: unknown, extra: object = {}) => ({ id, nome, preco, disponivel: true, ...extra })
function canon(nd: Node): string {
  if (nd.nodeType === 3) return nd.textContent!
  if (nd.nodeType !== 1) return ''
  const el = nd as HTMLElement
  const attrs = [...el.attributes].filter((a) => !(el instanceof HTMLInputElement && (a.name === 'value' || a.name === 'checked'))).map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  let t = '', fs: string[] = []
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1) { if (t) { fs.push(t); t = '' } fs.push(canon(c)) } }
  if (t) fs.push(t)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${fs.join('')}</>`
}
const doHtml = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.childNodes].map(canon).join('') }
const ssr = (pg: Programa) => { const d = document.createElement('div'); d.innerHTML = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo; return d }

describe('contratos de serviço', () => {
  it('são nós válidos; toda operação referencia uma entidade existente do próprio serviço; permissões e eventos declarados', () => {
    const r = novoReg()
    expect(r.ids('servico').sort()).toEqual(expect.arrayContaining(['carrinho', 'catalogo', 'pedidos']))
    for (const s of SERVICOS) {
      const spec = s.spec as { entidades: Record<string, unknown>; operacoes: Record<string, { saida?: string; permissao?: string }> }
      for (const [op, o] of Object.entries(spec.operacoes)) { expect(Object.keys(spec.entidades), `${s.id}.${op}`).toContain(o.saida); expect(o.permissao, `${s.id}.${op}`).toBeTruthy() }
    }
  })
  it('dinheiro é decimal exato (tipo `dinheiro`), nunca número: preço, total, desconto e frete', () => {
    const campos = (s: string, e: string) => ((SERVICOS.find((x) => x.id === s)!.spec as any).entidades[e].campos) as Record<string, { tipo: string }>
    for (const [s, e, f] of [['catalogo', 'produto', 'preco'], ['catalogo', 'produto', 'precoDe'], ['carrinho', 'itemCarrinho', 'precoUnitario'], ['carrinho', 'carrinho', 'total'], ['pedidos', 'pedido', 'frete']] as const) expect(campos(s, e)[f]!.tipo, `${e}.${f}`).toBe('dinheiro')
  })
  it('os blocos só leem campos que o contrato declara (acoplamento forma-dados conferido)', () => {
    const ent = (s: string, e: string) => Object.keys(((SERVICOS.find((x) => x.id === s)!.spec as any).entidades[e].campos))
    const props = (b: string, caminho: (p: any) => any) => Object.keys(caminho((BLOCOS_COMMERCE.find((x) => x.id === b)!.spec as any).props.properties))
    const produto = ent('catalogo', 'produto')
    for (const bloco of ['commerce.cartao-produto', 'commerce.detalhe-produto']) for (const c of props(bloco, (p) => p.produto.properties)) expect(produto, `${bloco}.${c}`).toContain(c)
    for (const c of props('commerce.carrinho', (p) => p.itens.items.properties)) expect(ent('carrinho', 'itemCarrinho'), c).toContain(c)
    for (const c of props('commerce.resumo-pedido', (p) => p)) { expect(ent('carrinho', 'carrinho'), c).toContain(c); expect(ent('pedidos', 'pedido'), c).toContain(c) }
  })
})

describe('blocos de exibição: dinheiro exato, vazios, links, disponibilidade', () => {
  const vitrine = (produtos: unknown[], extra: object = {}) => pagina({ bloco: 'commerce/vitrine', props: { produtos, hrefBase: '/produto/', ...extra } })
  it('vitrine: um cartão por produto, preço em reais exatos (texto ou número), "de …", link com id, selo de indisponível', () => {
    const d = ssr(vitrine([P('a', 'Pão', '24.90', { precoDe: '29.90' }), P('b', 'Bolo', 18, { disponivel: false }), P('c', 'Café', '0.1')]))
    const txt = d.textContent!.replace(/\s+/g, ' ')
    expect(txt).toContain('R$ 24,90'); expect(txt).toContain('de R$ 29,90'); expect(txt).toContain('R$ 18,00'); expect(txt).toContain('R$ 0,10')
    expect(d.querySelectorAll('h3').length).toBe(3)
    expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/produto/a', '/produto/b', '/produto/c'])
    expect(d.querySelectorAll('span[data-tom=erro]').length).toBe(1) // só o Bolo
    expect(d.querySelector('div[style*="repeat(3,"]')).not.toBeNull() // padrão: 3 colunas
  })
  it('dinheiro EXATO: onde o double erra (1.005, valor acima de 2^53) o preço sai certo', () => {
    const d = ssr(vitrine([P('a', 'Meio centavo', '1.005'), P('b', 'Enorme', '9007199254740993.00'), P('c', 'Negativo', '-0.005')]))
    const txt = d.textContent!.replace(/\s+/g, ' ')
    expect(txt).toContain('R$ 1,01'); expect(txt).toContain('R$ 9.007.199.254.740.993,00'); expect(txt).toContain('-R$ 0,01')
  })
  it('colunas explícitas; sem hrefBase não há link; lista vazia mostra a mensagem e nenhuma grade', () => {
    const d = ssr(vitrine([P('a', 'Pão', '1')], { colunas: 2, hrefBase: undefined }))
    expect(d.querySelector('div[style*="repeat(2,"]')).not.toBeNull(); expect(d.querySelectorAll('a').length).toBe(0)
    const v = ssr(vitrine([])); expect(v.textContent).toContain('Nenhum produto encontrado.'); expect(v.querySelector('div[style*="grid"]')).toBeNull()
  })
  it('detalhe do produto: título h1, preço, descrição, "Em estoque"/"Indisponível"', () => {
    const d = ssr(pagina({ bloco: 'commerce/detalhe-produto', props: { produto: P('a', 'Pão', '24.90', { descricao: 'Mineiro.' }) } }))
    expect(d.querySelector('h1')!.textContent).toBe('Pão'); expect(d.textContent).toContain('Mineiro.'); expect(d.textContent).toContain('Em estoque'); expect(d.textContent).not.toContain('Indisponível')
    const e = ssr(pagina({ bloco: 'commerce/detalhe-produto', props: { produto: P('a', 'Pão', '1', { disponivel: false }) } }))
    expect(e.textContent).toContain('Indisponível'); expect(e.textContent).not.toContain('Em estoque')
  })
  it('carrinho: linhas, totais exatos, desconto/frete só quando > 0, vazio com mensagem', () => {
    const itens = [{ id: 'i1', nome: 'Pão', quantidade: 2, precoUnitario: '24.90', total: '49.80' }, { id: 'i2', nome: 'Café', quantidade: 1, precoUnitario: '18.50', total: '18.50' }]
    const d = ssr(pagina({ bloco: 'commerce/carrinho', props: { itens, subtotal: '68.30', desconto: '0', frete: '12.00', total: '80.30' } }))
    const t = d.textContent!.replace(/\s+/g, ' ')
    expect(d.querySelectorAll('tbody')[0]!.querySelectorAll('tr').length).toBe(2)
    expect(t).toContain('R$ 49,80'); expect(t).toContain('R$ 68,30'); expect(t).toContain('Frete'); expect(t).toContain('R$ 12,00'); expect(t).toContain('R$ 80,30')
    expect(t).not.toContain('Desconto') // 0 não aparece
    const e = ssr(pagina({ bloco: 'commerce/carrinho', props: { itens: [] } }))
    expect(e.textContent).toContain('Seu carrinho está vazio.'); expect(e.querySelector('table')).toBeNull()
  })
  it('conteúdo hostil do catálogo é texto, e foto com javascript: não vira imagem', () => {
    const d = ssr(pagina({ bloco: 'commerce/cartao-produto', props: { produto: P('x', '<img src=x onerror=alert(1)>', '1', { fotoUrl: 'javascript:alert(1)' }) } }))
    expect(d.querySelector('img')).toBeNull(); expect(d.querySelector('h3')!.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('paridade React × vivo (servidor e cliente) para todo exemplo do pack', () => {
  const r = novoReg()
  for (const b of BLOCOS_COMMERCE as any[]) for (const ex of b.spec.exemplos as any[]) {
    it(`${b.spec.interface} › ${ex.titulo}`, () => {
      const pg = pagina(ex.instancia, {}, r)
      const oraculo = doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo)
      const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
      expect(doHtml(h.pagina.render({}).corpo)).toBe(oraculo)
      const c = document.createElement('div'); montaVivo({ programa: pg, container: c })
      expect([...c.childNodes].map(canon).join('')).toBe(oraculo)
    })
  }
  it('o catálogo documenta o pack sem exemplo inválido', () => {
    const c = geraCatalogo(r)
    expect(c.erros).toEqual([]); expect(c.markdown).toContain('### Carrinho (`commerce/carrinho`)'); expect(c.markdown).toContain('| `acoes` | qualquer bloco |')
  })
})

describe('integração: ações da página dentro do slot `acoes` (o escopo é o da página, com a variável do repetir)', () => {
  it('"Adicionar" em cada cartão enxerga `p` e o estado da página; atualiza o carrinho exibido', () => {
    const produtos = [P('a', 'Pão', '24.90'), P('b', 'Café', '18.50')]
    const pg = pagina({ bloco: 'layout/pilha', slots: { filhos: [
      { bloco: 'layout/grade', props: { colunas: 2 }, slots: { filhos: [
        { bloco: 'commerce/cartao-produto', repetir: { cada: 'estado.produtos', como: 'p', chave: 'p.id' }, props: { produto: '{p}' }, slots: { acoes: [
          { bloco: 'nav/botao', id: 'add-{p.id}', props: { texto: 'Adicionar' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'escolhidos', valor: 'insere(estado.escolhidos, tamanho(estado.escolhidos), p)' }] } },
        ] } },
      ] } },
      { bloco: 'texto/paragrafo', id: 'qtd', props: { texto: 'no carrinho: {tamanho(estado.escolhidos)}' } },
    ] } }, { estado: { produtos: { tipo: 'json', inicial: produtos }, escolhidos: { tipo: 'json', inicial: [] } } })
    const c = document.createElement('div'); document.body.appendChild(c)
    const v = montaVivo({ programa: pg, container: c, fechado: true })
    const botoes = [...c.querySelectorAll('button')]
    expect(botoes.length).toBe(2)
    botoes[1]!.click(); botoes[1]!.click(); botoes[0]!.click()
    expect(c.querySelector('#qtd')!.textContent).toBe('no carrinho: 3')
    expect((v.store().estado.escolhidos as Array<{ id: string }>).map((x) => x.id)).toEqual(['b', 'b', 'a']) // cada clique enxergou o `p` do SEU cartão
  })
})
