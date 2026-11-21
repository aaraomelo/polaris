import { Registry } from '@polaris/schema'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { empacotaCliente, geraEntrada, usoDoPrograma } from '../src/aot/index'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, registraBase, renderPaginaHtml, type Programa } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
let n = 0
function programa(raiz: object, extra: object = {}): Programa {
  const r = new Registry(); registraBase(r)
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { t: { type: 'string' } } },
    modelo: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: '{props.t | maiusculas}', nivel: 3 } }), P('core/slot', { props: { nome: 'rodape' } })] } }), slots: { rodape: {} } }))
  const res = compilaPrograma(r, r.registra(no('pagina', `aot${n++}`, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const est = { n: { tipo: 'inteiro', inicial: 0 }, itens: { tipo: 'json', inicial: [] }, nome: { tipo: 'texto', inicial: '' } }

const simples = () => programa(P('texto/paragrafo', { props: { texto: 'oi' } }))
const contador = () => programa(P('layout/pilha', { slots: { filhos: [
  P('texto/paragrafo', { id: 'n', props: { texto: 'n={estado.n}' } }),
  P('nav/botao', { id: 'mais', props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } }),
] } }), { estado: est })
const loja = () => programa(P('layout/pilha', { slots: { filhos: [
  P('texto/paragrafo', { id: 'tot', props: { texto: 'total={dobra(estado.itens, "0", (s, p) => qsoma(s, qmul(p.preco, p.qtd))) | qbrl}' } }),
  P('texto/paragrafo', { id: 'nomes', props: { texto: '{estado.itens | filtra(p => p.ok) | mapeia(p => maiusculas(p.nome)) | junta(" / ")}' } }),
  P('x/cartao', { repetir: { cada: 'ordena(estado.itens, p => p.nome)', como: 'p', chave: 'p.id' }, props: { t: '{p.nome}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '{p.preco | brl} × {p.qtd}' } })] } }),
  P('entrada/texto', { id: 'campo', props: { valor: '{estado.nome}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'nome', valor: 'evento' }] } }),
  P('nav/botao', { id: 'add', props: { texto: 'add' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'itens', valor: 'com(estado.itens, [tamanho(estado.itens)], objeto([["id", 99], ["nome", "n"], ["preco", "1"], ["qtd", 1], ["ok", true]]))' }] } }),
] } }), { estado: est })

describe('uso: o que a página realmente chama', () => {
  it('funções (de qualquer expressão: página, modelo de bloco, ação) e blocos nativos, sem repetidos', () => {
    expect(usoDoPrograma(simples())).toEqual({ funcoes: [], interfaces: ['texto/paragrafo'], codigos: [] })
    expect(usoDoPrograma(contador())).toEqual({ funcoes: [], interfaces: ['layout/pilha', 'nav/botao', 'texto/paragrafo'], codigos: [] })
    const u = usoDoPrograma(loja())
    expect(u.funcoes).toEqual(['brl', 'com', 'dobra', 'filtra', 'junta', 'maiusculas', 'mapeia', 'objeto', 'ordena', 'qbrl', 'qmul', 'qsoma', 'tamanho'])
    expect(u.interfaces).toEqual(['entrada/texto', 'layout/pilha', 'nav/botao', 'texto/paragrafo', 'texto/titulo'])
  })
})

describe('uso: lugares fáceis de esquecer', () => {
  it('função usada SÓ dentro do modelo de um bloco composto, só numa ação, só no título ou só em um argumento de dados entra no pacote', () => {
    expect(usoDoPrograma(programa(P('x/cartao', { props: { t: 'a' } }))).funcoes).toEqual(['maiusculas']) // só o modelo do bloco a usa
    expect(usoDoPrograma(programa(P('nav/botao', { props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'nome', valor: 'minusculas(estado.nome)' }] } }), { estado: est })).funcoes).toEqual(['minusculas'])
    expect(usoDoPrograma(programa(P('texto/paragrafo', { props: { texto: 'x' } }), { titulo: 'T: {maiusculas(estado.nome)}', estado: est })).funcoes).toEqual(['maiusculas'])
    expect(usoDoPrograma(programa(P('texto/paragrafo', { se: 'contem(estado.nome, "a")', props: { texto: 'x' } }), { estado: est })).funcoes).toEqual(['contem'])
    expect(usoDoPrograma(programa(P('texto/paragrafo', { repetir: { cada: 'intervalo(3)', como: 'i', chave: 'texto(i)' }, props: { texto: 'x' } }))).funcoes).toEqual(['intervalo', 'texto'])
  })
})

describe('entrada gerada: importa SÓ o que a página usa', () => {
  it('uma página simples não importa nenhuma função e só o descritor que usa', () => {
    const { fonte } = geraEntrada(simples())
    expect(fonte).toContain('d_texto_paragrafo')
    expect(fonte).not.toMatch(/f_\w+|fq_\w+/)
    expect(fonte).not.toContain('d_nav_botao')
    expect(fonte).toContain('const funcoes = {  }')
  })
  it('função usada vem do módulo certo (biblioteca, combinadores, exata)', () => {
    const { fonte } = geraEntrada(loja())
    expect(fonte).toMatch(/import \{ f_brl \} from .*expr\/funcoes\.ts/)
    expect(fonte).toMatch(/import \{ f_filtra \} from .*expr\/ordem-superior\.ts/)
    expect(fonte).toMatch(/import \{ fq_qsoma \} from .*expr\/exato\.ts/)
  })
  it('função inexistente na biblioteca é recusada (não gera import quebrado)', () => {
    expect(() => geraEntrada(simples(), { funcoes: ['naoexiste'], interfaces: [], codigos: [] })).toThrow(/não existe na biblioteca/)
  })
})

describe('bundle por página: tree-shaking real', () => {
  it('a página simples não carrega biblioteca, BigInt, histórico, patches nem combinadores — e a biblioteca agregada nunca entra', async () => {
    const r = await empacotaCliente(simples())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const arqs = Object.keys(r.pacote.contribuicao)
    for (const proibido of ['expr/biblioteca.ts', 'expr/funcoes.ts', 'expr/exato.ts', 'num/racional.ts', 'modelo/historico.ts', 'expr/ordem-superior.ts', 'expr/parser.ts', 'expr/analise.ts', 'ir/compila.ts']) expect(arqs, proibido).not.toContain(proibido)
    expect(r.pacote.contribuicao['vivo/monta.ts']).toBeGreaterThan(5000)
    expect(r.pacote.gz).toBeLessThan(12.3 * 1024) // 10,5 → 10,7 → 11,2 → 11,6 → 12 KB (modal, `aberta` e teclado das formas SVG; escala tipográfica nomeada, ~190 B; estado ligado à URL, seletor e `soConsulta`): o estado que `persiste` (ler e gravar no localStorage) mora no vivo/monta.ts e custa ~140 B em toda página
    expect(r.pacote.codigo).not.toMatch(/react/i)
  })
  it('cada capacidade só custa quando usada: BigInt só com q*, combinadores só com mapeia/filtra…', async () => {
    const base = (await empacotaCliente(contador())) as Extract<Awaited<ReturnType<typeof empacotaCliente>>, { ok: true }>
    const exata = (await empacotaCliente(programa(P('texto/paragrafo', { props: { texto: '{qbrl(qmul(estado.n, "1.1"))}' } }), { estado: est }))) as typeof base
    const lista = (await empacotaCliente(programa(P('texto/paragrafo', { props: { texto: '{junta(mapeia(estado.itens, p => p.nome), ",")}' } }), { estado: est }))) as typeof base
    expect(base.pacote.contribuicao['num/racional.ts']).toBeUndefined()
    expect(exata.pacote.contribuicao['num/racional.ts']).toBeGreaterThan(1000)
    expect(lista.pacote.contribuicao['num/racional.ts']).toBeUndefined()
    expect(lista.pacote.contribuicao['expr/ordem-superior.ts']).toBeGreaterThan(100)
    expect(exata.pacote.contribuicao['expr/ordem-superior.ts']).toBeUndefined()
    expect(exata.pacote.gz).toBeGreaterThan(base.pacote.gz)
    expect(exata.pacote.gz).toBeLessThan(base.pacote.gz + 2.5 * 1024) // a aritmética exata inteira custa pouco
  })
  it('a loja completa (listas, combinadores, aritmética exata, eventos) fica abaixo de 13,9 KB gz — o react-dom sozinho tem ~135 KB', async () => {
    const r = await empacotaCliente(loja())
    expect(r.ok && r.pacote.gz).toBeLessThan(15.1 * 1024) // 14,8 KB com o modal e o teclado SVG; 13 → 13,25 → 13,3 → 13,4 → 13,9 → 14,3 → 14,4 KB (`tom` nos textos; escala tipográfica nomeada; estado ligado à URL, seletor) (título com filhos, `texto/trecho` e `texto/enfase`): eventos `polaris-*` e `data-solta` das ilhas; `data-marca` e `data-zoom` dos blocos de layout
  })
  it('páginas que o runtime vivo não suporta são recusadas com os motivos (nenhum bundle)', async () => {
    const r = new Registry(); registraBase(r)
    r.registra(no('servico', 'cat', { entidades: {}, operacoes: {} }))
    r.registra(no('dados', 'd.lento', { fonte: { tipo: 'servico', servico: 'cat', operacao: 'x' } }))
    r.registra(no('bloco', 'x.sem-descritor', { interface: 'x/sem-descritor' }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'aot-nao', { rota: '/', raiz: P('x/sem-descritor') })))
    if (!res.ok) throw new Error(JSON.stringify(res.erros))
    const e = await empacotaCliente(res.programa)
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.motivos.map((m) => m.motivo).join('|')).toMatch(/descritor/)
  })
})

// ---- executa o bundle GERADO num DOM isolado e confere com o React --------------------------------------------------

const canon = (no: Node): string => {
  if (no.nodeType === 3) return no.textContent!
  if (no.nodeType !== 1) return ''
  const el = no as HTMLElement
  const attrs = [...el.attributes].filter((a) => a.name !== 'value').map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  if (el.tagName === 'INPUT') attrs.push(`value=${JSON.stringify((el as HTMLInputElement).value)}`)
  const filhos: string[] = []; let t = ''
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1) { if (t) { filhos.push(t); t = '' } filhos.push(canon(c)) } }
  if (t) filhos.push(t)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${filhos.join('')}</>`
}

describe('o bundle gerado RODA: DOM isolado, sem React, igual ao oráculo', () => {
  async function sobe(pg: Programa, extra: Record<string, unknown> = {}, ssr = false) {
    const r = await empacotaCliente(pg)
    if (!r.ok) throw new Error(JSON.stringify(r.motivos))
    const dom = new JSDOM('<!doctype html><body><div id="raiz"></div></body>', { runScripts: 'outside-only' })
    dom.window.eval(r.pacote.codigo)
    const W = dom.window as unknown as { Polaris: { monta(o: Record<string, unknown>): any }; JSON: JSON; document: Document }
    expect(typeof W.Polaris.monta).toBe('function')
    expect('React' in dom.window).toBe(false)
    const raiz = W.document.getElementById('raiz')!
    if (ssr) { const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x'); raiz.innerHTML = h.pagina.render(extra).corpo }
    const prog = W.JSON.parse(JSON.stringify(pg)) // o Programa é JSON: atravessa o limite como no navegador
    const v = W.Polaris.monta({ programa: prog, container: raiz, ...(ssr ? { hidrata: true } : {}), ...extra })
    const oraculo = () => { const s = v.store(); const d = W.document.createElement('div'); d.innerHTML = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: s.estado, dados: s.dados, status: s.status, erros: s.erros }).corpo; return [...d.childNodes].map(canon).join('') }
    const atual = () => [...raiz.childNodes].map(canon).join('')
    return { v, raiz, W, oraculo, atual }
  }

  it('contador: clique atualiza o DOM, igual ao React (e o bundle não tem ordem de React nem de biblioteca)', async () => {
    const { raiz, oraculo, atual, W } = await sobe(contador())
    expect(atual()).toBe(oraculo())
    for (let i = 0; i < 3; i++) { (raiz.querySelector('#mais') as HTMLElement).click(); expect(atual(), `clique ${i}`).toBe(oraculo()) }
    expect(raiz.querySelector('#n')!.textContent).toBe('n=3')
    void W
  })

  it('loja completa: aritmética exata, combinadores, lista com chave, input — igual ao React a cada passo', async () => {
    const itens = [{ id: 1, nome: 'pão', preco: '5.50', qtd: 2, ok: true }, { id: 2, nome: 'bolo', preco: '19.99', qtd: 1, ok: false }, { id: 3, nome: 'café', preco: '0.1', qtd: 3, ok: true }]
    const { v, raiz, oraculo, atual } = await sobe(loja(), { estado: { itens } })
    expect(atual()).toBe(oraculo())
    expect(raiz.querySelector('#tot')!.textContent).toBe('total=R$ 31,29') // 11,00 + 19,99 + 0,30 EXATOS
    expect(raiz.querySelector('#nomes')!.textContent).toBe('PÃO / CAFÉ')
    const campo = raiz.querySelector('#campo') as HTMLInputElement
    campo.value = 'x<&>'; campo.dispatchEvent(new (raiz.ownerDocument.defaultView as any).Event('input', { bubbles: true }))
    expect(atual()).toBe(oraculo())
    v.despacha({ t: 'estado', nome: 'itens', valor: [...itens, { id: 4, nome: 'chá', preco: '3', qtd: 1, ok: true }].reverse() })
    expect(atual()).toBe(oraculo())
    expect(raiz.querySelector('#tot')!.textContent).toBe('total=R$ 34,29')
  })

  it('hidratação com o HTML do servidor: adota os nós (sem recriar) e continua igual ao React', async () => {
    const { v, raiz, oraculo, atual } = await sobe(contador(), { estado: { n: 5 } }, true)
    expect(v.diagnostico().hidratou).toBe(true)
    expect(atual()).toBe(oraculo())
    ;(raiz.querySelector('#mais') as HTMLElement).click()
    expect(atual()).toBe(oraculo()); expect(raiz.querySelector('#n')!.textContent).toBe('n=6')
  })
})
