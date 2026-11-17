// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, FUNCOES_PADRAO, compilaPrograma, elegivelVivo, montaVivo, registraBase, renderPaginaHtml, type Programa, type Vivo } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

function registry() {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'loja' } }))
  r.registra(no('bloco', 'x.cartao', {
    interface: 'x/cartao', slots: { rodape: {} }, props: { type: 'object', properties: { titulo: { type: 'string' }, preco: { type: 'number' } } },
    modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [
      P('texto/titulo', { props: { texto: '{props.titulo}', nivel: 3 } }),
      P('texto/paragrafo', { se: 'props.preco != null', props: { texto: '{props.preco | brl}' } }),
      P('core/slot', { props: { nome: 'rodape' } }),
    ] } }),
  }))
  r.registra(no('bloco', 'x.cond', {
    interface: 'x/cond', slots: { corpo: {} }, props: { type: 'object', properties: { ligado: { type: 'boolean' } } },
    modelo: P('layout/pilha', { slots: { filhos: [P('core/slot', { se: 'props.ligado', props: { nome: 'corpo' } })] } }),
  }))
  return r
}
let n = 0
function programa(raiz: object, extra: object = {}): Programa {
  const r = registry()
  const res = compilaPrograma(r, r.registra(no('pagina', `p${n++}`, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

// ---- oráculo: DOM canônico --------------------------------------------------
function serial(no: Node): string {
  if (no.nodeType === 3) return no.textContent!
  if (no.nodeType !== 1) return ''
  const el = no as HTMLElement
  const attrs = [...el.attributes].filter((a) => a.name !== 'value').map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  if (el.tagName === 'INPUT') attrs.push(`value=${JSON.stringify((el as HTMLInputElement).value)}`)
  const filhos: string[] = []
  let texto = ''
  for (const c of [...el.childNodes]) {
    if (c.nodeType === 3) texto += c.textContent
    else if (c.nodeType === 1) { if (texto) { filhos.push(texto); texto = '' } filhos.push(serial(c)) }
  }
  if (texto) filhos.push(texto)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${filhos.join('')}</>`
}
const canon = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.childNodes].map(serial).join('') }
const doContainer = (c: Element) => [...c.childNodes].map(serial).join('')

function oraculo(pg: Programa, v: Vivo, base: Record<string, unknown> = {}) {
  const s = v.store()
  return canon(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, ...base, estado: s.estado, dados: s.dados, status: s.status, erros: s.erros }).corpo)
}
function sobe(pg: Programa, base: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const v = montaVivo({ programa: pg, container, ...base, ...extra })
  return { container, v, confere: (rotulo = '') => expect(doContainer(container), rotulo).toBe(oraculo(pg, v, base)) }
}

describe('vivo: construção inicial igual ao React', () => {
  it('blocos base, compostos com slot, se e repetir', () => {
    const pg = programa(P('layout/pilha', { id: 'r', props: { gap: 8, alinha: 'centro' }, slots: { filhos: [
      P('texto/titulo', { props: { texto: '{estado.nome}', nivel: '{estado.n}' } }),
      P('texto/paragrafo', { se: 'estado.mostra', props: { texto: 'n={estado.n} <&>' } }),
      P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { titulo: '{p.nome}', preco: '{p.preco}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '#{indice} {p.id} {estado.nome}' } })] } }),
      P('nav/link', { props: { href: '{estado.url}', texto: 'ir' } }),
      P('midia/imagem', { props: { src: '{estado.url}', alt: 'a"b' } }),
      P('entrada/texto', { props: { valor: '{estado.nome}', placeholder: 'x' } }),
      P('nav/botao', { props: { texto: 'ok', desabilitado: '{estado.mostra}' } }),
    ] } }), { estado: {
      nome: { tipo: 'texto', inicial: "Sol & 'Lua'" }, n: { tipo: 'inteiro', inicial: 2 }, mostra: { tipo: 'booleano', inicial: true }, url: { tipo: 'texto', inicial: '/p?a=1&b=2' },
      itens: { tipo: 'json', inicial: [{ id: 1, nome: 'pão', preco: 5.5 }, { id: 2, nome: '<b>', preco: null }] },
    } })
    sobe(pg).confere()
  })
  it('elegibilidade: streaming e bloco sem descritor ficam de fora', () => {
    expect(elegivelVivo(programa(P('texto/paragrafo', { props: { texto: 'x' } }))).ok).toBe(true)
    const r = registry(); r.registra(no('bloco', 'x.novo', { interface: 'x/novo' }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'pz', { rota: '/', raiz: P('x/novo') })))
    if (!res.ok) throw new Error('x')
    const e = elegivelVivo(res.programa)
    expect(!e.ok && e.motivos[0]!.motivo).toContain('descritor')
  })
})

const paginaLista = () => programa(P('layout/pilha', { slots: { filhos: [
  P('texto/titulo', { props: { texto: '{estado.nome}', nivel: '{estado.n}' } }),
  P('texto/paragrafo', { se: 'estado.mostra', props: { texto: 'n={estado.n} nome={estado.nome}' } }),
  P('texto/paragrafo', { se: 'estado.mostra && estado.n > 2', props: { texto: 'n>2' } }),
  P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { titulo: '{p.nome}', preco: '{p.preco}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '#{indice} id={p.id} {estado.nome}' } })] } }),
  P('texto/paragrafo', { repetir: { cada: 'estado.itens', como: 'q' }, props: { texto: 'sem chave {indice}:{q.nome}' } }),
  P('texto/paragrafo', { repetir: { cada: 'loja.itens', como: 'x' }, props: { texto: '{x}' } }),
  P('texto/paragrafo', { se: 'status.loja == "erro"', props: { texto: 'erro: {erros.loja}' } }),
  P('nav/link', { props: { href: '{estado.url}', texto: 'ir' } }),
  P('midia/imagem', { props: { src: '{estado.url}', alt: '{estado.nome}' } }),
  P('entrada/texto', { props: { valor: '{estado.nome}' } }),
] } }), {
  dados: { loja: 'd.loja' },
  estado: {
    nome: { tipo: 'texto', inicial: 'a' }, n: { tipo: 'inteiro', inicial: 1 }, mostra: { tipo: 'booleano', inicial: true }, url: { tipo: 'texto', inicial: '/p' },
    itens: { tipo: 'json', inicial: [] },
  },
})

describe('vivo: o DOM acompanha o store (oráculo = SSR do React com o mesmo estado)', () => {
  it('cenários dirigidos: texto, atributo, se, nível do título (troca de tag), tipo de URL', () => {
    const pg = paginaLista()
    const { v, confere } = sobe(pg)
    confere('inicial')
    v.despacha({ t: 'estado', nome: 'nome', valor: `x<&>"'` }); confere('nome')
    v.despacha({ t: 'estado', nome: 'n', valor: 4 }); confere('nível 4 + n>2')
    v.despacha({ t: 'estado', nome: 'n', valor: 9 }); confere('nível limitado a 6')
    v.despacha({ t: 'estado', nome: 'mostra', valor: false }); confere('some')
    v.despacha({ t: 'estado', nome: 'mostra', valor: true }); confere('volta')
    v.despacha({ t: 'estado', nome: 'url', valor: 'javascript:alert(1)' }); confere('url insegura some com a imagem e o href')
    v.despacha({ t: 'estado', nome: 'url', valor: 'https://e.com/x?y=1&z=2' }); confere('url externa ganha rel')
    v.despacha({ t: 'dado', nome: 'loja', valor: { itens: ['a', 'b'] } }); confere('dado chegou')
    v.despacha({ t: 'erro', nome: 'loja', erro: 'falhou <x>' }); confere('erro')
  })

  it('lista com chave: inserir, remover, mover, atualizar item — nós existentes mantêm identidade', () => {
    const pg = paginaLista()
    const itens = (...ids: number[]) => ids.map((id) => ({ id, nome: `item ${id}`, preco: id * 1.5 }))
    const { v, container, confere } = sobe(pg, {}, { estado: { itens: itens(1, 2, 3, 4) } })
    confere('inicial')
    const titulos = () => new Map([...container.querySelectorAll('h3')].map((h) => [h.textContent!, h]))
    const antes = titulos()
    v.despacha({ t: 'estado', nome: 'itens', valor: itens(4, 3, 2, 1) }); confere('invertida')
    v.despacha({ t: 'estado', nome: 'itens', valor: itens(4, 9, 2, 1, 7) }); confere('insere e remove')
    const depois = titulos()
    for (const k of ['item 4', 'item 2', 'item 1']) expect(depois.get(k), k).toBe(antes.get(k)) // mesmo nó DOM, só movido
    v.despacha({ t: 'estado', nome: 'itens', valor: [{ id: 4, nome: 'renomeado', preco: 1 }, ...itens(2, 1)] }); confere('item atualizado no lugar')
    expect(titulos().get('renomeado')).toBe(antes.get('item 4')) // o nó foi reaproveitado
    v.despacha({ t: 'estado', nome: 'itens', valor: [] }); confere('vazia')
  })

  it('FUZZ: sequências aleatórias de ações dão sempre o mesmo DOM que o React', () => {
    let s = 99
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const ri = (k: number) => Math.floor(rnd() * k)
    const pg = paginaLista()
    const textos = ['', 'a', "x<&>'\"", 'ç日😀', 'n  m']
    const urls = ['/p', 'javascript:x', 'https://e.com/a?b=1&c=2', ' /rel', '', 'mailto:a@b.c']
    for (let rodada = 0; rodada < 60; rodada++) {
      const { v, container, confere } = sobe(pg)
      for (let passo = 0; passo < 25; passo++) {
        const k = ri(8)
        if (k === 0) v.despacha({ t: 'estado', nome: 'nome', valor: textos[ri(textos.length)] })
        else if (k === 1) v.despacha({ t: 'estado', nome: 'n', valor: ri(9) - 1 })
        else if (k === 2) v.despacha({ t: 'estado', nome: 'mostra', valor: rnd() < 0.5 })
        else if (k === 3) v.despacha({ t: 'estado', nome: 'url', valor: urls[ri(urls.length)] })
        else if (k <= 5) {
          const ids = Array.from({ length: 12 }, (_, i) => i).sort(() => rnd() - 0.5).slice(0, ri(10))
          v.despacha({ t: 'estado', nome: 'itens', valor: ids.map((id) => ({ id, nome: rnd() < 0.7 ? `i${id}` : `r${id}${ri(3)}`, preco: rnd() < 0.2 ? null : id * 1.25 })) })
        } else if (k === 6) v.despacha({ t: 'dado', nome: 'loja', valor: rnd() < 0.2 ? null : { itens: Array.from({ length: ri(5) }, () => textos[ri(textos.length)]) } })
        else v.despacha(rnd() < 0.5 ? { t: 'erro', nome: 'loja', erro: textos[ri(textos.length)]! } : { t: 'carregando', nome: 'loja' })
        confere(`rodada ${rodada} passo ${passo} (ação ${k})`)
      }
      v.destroi()
      container.remove()
    }
  })
})

describe('vivo: eventos (delegação) e ações', () => {
  const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms))
  const digita = (el: HTMLInputElement, v: string) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  const pagina = () => programa(P('layout/pilha', { slots: { filhos: [
    P('nav/botao', { id: 'mais', props: { texto: 'mais' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }, { acao: 'definir', estado: 'n', valor: 'estado.n * 10' }] } }),
    P('entrada/texto', { id: 'campo', props: { valor: '{estado.nome}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'nome', valor: 'evento' }] } }),
    P('entrada/texto', { id: 'preso', props: { valor: 'fixo' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'ignorado', valor: 'evento' }] } }),
    P('texto/paragrafo', { id: 'saida', props: { texto: '{estado.n}|{estado.nome}|{estado.msg}' } }),
    P('nav/botao', { id: 'busca', props: { texto: 'busca' }, eventos: { aoClicar: [{ acao: 'executar', dados: 'loja', args: {}, depois: [{ acao: 'definir', estado: 'msg', valor: "'ok:' + resultado.itens.length" }], emErro: [{ acao: 'definir', estado: 'msg', valor: "'erro:' + erro" }] }] } }),
    P('texto/paragrafo', { id: 'item', repetir: { cada: 'loja.itens', como: 'x', chave: 'x' }, props: { texto: '{x}' } }),
  ] } }), { dados: { loja: 'd.loja' }, estado: { n: { tipo: 'inteiro', inicial: 1 }, nome: { tipo: 'texto', inicial: '' }, msg: { tipo: 'texto', inicial: '' }, ignorado: { tipo: 'texto', inicial: '' } } })

  it('clique executa a sequência de ações e o DOM acompanha; digitar atualiza o estado e o campo', () => {
    const pg = pagina()
    const { container, v, confere } = sobe(pg)
    const q = (id: string) => container.querySelector(`#${id}`) as HTMLElement
    q('mais').click(); confere('clique'); expect(q('saida').textContent).toBe('20||')
    digita(q('campo') as HTMLInputElement, 'olá'); confere('digitou')
    expect(q('saida').textContent).toBe('20|olá|')
    expect((q('campo') as HTMLInputElement).value).toBe('olá')
    v.despacha({ t: 'estado', nome: 'nome', valor: 'externo' })
    expect((q('campo') as HTMLInputElement).value).toBe('externo') // mudança vinda de fora chega ao campo
  })

  it('campo controlado: se a ação não aceita o valor, o campo volta ao valor da prop (como no React)', () => {
    const { container } = sobe(pagina())
    const preso = container.querySelector('#preso') as HTMLInputElement
    digita(preso, 'tentativa')
    expect(preso.value).toBe('fixo')
  })

  it('ação assíncrona: executar → carregando → dado → depois; erro → emErro; resposta antiga é descartada', async () => {
    let resolve!: (v: unknown) => void
    let modo: 'ok' | 'erro' = 'ok'
    const carregador = () => new Promise((res, rej) => { resolve = modo === 'ok' ? res : () => rej(new Error('falhou')) })
    const pg = pagina()
    const { container, v, confere } = sobe(pg, {}, { carregador })
    const q = (id: string) => container.querySelector(`#${id}`) as HTMLElement
    q('busca').click(); confere('carregando'); expect(v.store().status.loja).toBe('carregando')
    resolve({ itens: ['a', 'b', 'c'] }); await espera()
    confere('dado chegou'); expect(q('saida').textContent).toBe('1||ok:3'); expect(container.querySelectorAll('#item')).toHaveLength(3)
    modo = 'erro'; q('busca').click(); resolve(null); await espera()
    confere('erro'); expect(q('saida').textContent).toBe('1||erro:falhou')
  })

  it('destroi: para de reagir e remove os listeners', () => {
    const pg = pagina()
    const { container, v } = sobe(pg)
    const antes = container.innerHTML
    v.destroi()
    ;(container.querySelector('#mais') as HTMLElement).click()
    v.despacha({ t: 'estado', nome: 'n', valor: 99 })
    expect(container.innerHTML).toBe(antes)
  })

  it('chaves repetidas na lista são desambiguadas sem quebrar (igual ao React: um nó por item)', () => {
    const pg = paginaLista()
    const { v, confere } = sobe(pg)
    v.despacha({ t: 'estado', nome: 'itens', valor: [{ id: 1, nome: 'a' }, { id: 1, nome: 'b' }, { id: 2, nome: 'c' }] }); confere('duplicadas')
    v.despacha({ t: 'estado', nome: 'itens', valor: [{ id: 2, nome: 'c' }, { id: 1, nome: 'b' }, { id: 1, nome: 'a' }] }); confere('duplicadas reordenadas')
  })
})

describe('vivo: só reavalia o que depende do que mudou (e nada do que foi removido)', () => {
  /** conta as chamadas de `maiusculas` (função pura usada só como sonda) */
  function sonda() {
    const f = FUNCOES_PADRAO.maiusculas!
    const orig = f.fn
    let n = 0
    f.fn = (...a: unknown[]) => { n++; return orig(...a) }
    return { vezes: () => n, zera: () => { n = 0 }, restaura: () => { f.fn = orig } }
  }
  const pagina = () => programa(P('layout/pilha', { slots: { filhos: [
    P('texto/paragrafo', { id: 'a', props: { texto: '{estado.a | maiusculas}' } }),
    P('texto/paragrafo', { id: 'b', props: { texto: 'fixo' } }),
    P('texto/paragrafo', { se: 'estado.mostra', props: { texto: '{estado.b | maiusculas}' } }),
    P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { titulo: '{p.nome | maiusculas}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '{estado.c | maiusculas}' } })] } }),
  ] } }), { estado: {
    a: { tipo: 'texto', inicial: 'x' }, b: { tipo: 'texto', inicial: 'y' }, c: { tipo: 'texto', inicial: 'z' }, n: { tipo: 'inteiro', inicial: 0 }, mostra: { tipo: 'booleano', inicial: true },
    itens: { tipo: 'json', inicial: [{ id: 1, nome: 'um' }, { id: 2, nome: 'dois' }, { id: 3, nome: 'tres' }] },
  } })

  it('uma chave sem relação com nada não reavalia nenhuma expressão nem toca o DOM', () => {
    const s = sonda()
    try {
      const { v, container } = sobe(pagina())
      s.zera()
      const muta: MutationRecord[] = []
      const ob = new MutationObserver((r) => muta.push(...r)); ob.observe(container, { subtree: true, childList: true, attributes: true, characterData: true })
      v.despacha({ t: 'estado', nome: 'n', valor: 5 })
      expect(s.vezes()).toBe(0)
      expect(ob.takeRecords()).toHaveLength(0)
      v.despacha({ t: 'estado', nome: 'a', valor: 'novo' })
      expect(s.vezes()).toBe(1) // só `estado.a | maiusculas`; as demais dependem de outras chaves
      v.despacha({ t: 'estado', nome: 'c', valor: 'w' })
      expect(s.vezes()).toBe(1 + 3) // o rodapé de cada um dos 3 cartões
      ob.disconnect()
    } finally { s.restaura() }
  })

  it('itens removidos (e a região `se` desligada) deixam de ser avaliados', () => {
    const s = sonda()
    try {
      const { v, confere } = sobe(pagina())
      v.despacha({ t: 'estado', nome: 'itens', valor: [{ id: 2, nome: 'dois' }] }); confere()
      s.zera(); v.despacha({ t: 'estado', nome: 'c', valor: 'q' })
      expect(s.vezes()).toBe(1) // só o item que sobrou
      v.despacha({ t: 'estado', nome: 'mostra', valor: false }); confere()
      s.zera(); v.despacha({ t: 'estado', nome: 'b', valor: 'r' })
      expect(s.vezes()).toBe(0) // `se` desligado: nada de `estado.b`
      v.despacha({ t: 'estado', nome: 'itens', valor: [] }); confere()
      s.zera(); v.despacha({ t: 'estado', nome: 'c', valor: 'p' })
      expect(s.vezes()).toBe(0)
    } finally { s.restaura() }
  })

  it('slot dentro de `se` do modelo: ao desligar, o conteúdo (construído no escopo de fora) também para de ser avaliado', () => {
    const s = sonda()
    try {
      const pg = programa(P('x/cond', { props: { ligado: '{estado.mostra}' }, slots: { corpo: [P('texto/paragrafo', { props: { texto: '{estado.c | maiusculas}' } })] } }),
        { estado: { c: { tipo: 'texto', inicial: 'z' }, mostra: { tipo: 'booleano', inicial: true } } })
      const { v, confere } = sobe(pg)
      confere('ligado')
      s.zera(); v.despacha({ t: 'estado', nome: 'c', valor: 'k' }); expect(s.vezes()).toBe(1); confere()
      v.despacha({ t: 'estado', nome: 'mostra', valor: false }); confere('desligado')
      s.zera(); v.despacha({ t: 'estado', nome: 'c', valor: 'j' }); expect(s.vezes()).toBe(0)
      v.despacha({ t: 'estado', nome: 'mostra', valor: true }); confere('religado com o valor mais novo')
    } finally { s.restaura() }
  })

  it('repetir.chave é validada na compilação: escopo do item e caminho do erro', () => {
    const r = registry()
    const res = compilaPrograma(r, r.registra(no('pagina', 'pc', { rota: '/', estado: { l: { tipo: 'json', inicial: [] } },
      raiz: P('texto/paragrafo', { repetir: { cada: 'estado.l', como: 'p', chave: 'q.id' }, props: { texto: 'x' } }) })))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.erros.some((e) => e.caminho.endsWith('/repetir/chave') && /'q'/.test(e.mensagem))).toBe(true)
  })
})
