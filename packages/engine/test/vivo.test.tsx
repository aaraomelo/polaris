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

import { compilaHtmlVivo } from '../src/index'

describe('hidratação: o cliente ADOTA o HTML do servidor (sem recriar nós) e continua igual ao React', () => {
  const pagina = () => programa(P('layout/pilha', { id: 'raiz', slots: { filhos: [
    P('texto/titulo', { props: { texto: '{estado.nome}', nivel: 2 } }),
    P('texto/paragrafo', { se: 'estado.mostra', props: { texto: 'n={estado.n} <&>' } }),
    P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { titulo: '{p.nome}', preco: '{p.preco}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '#{indice} {estado.nome}' } })] } }),
    P('nav/botao', { id: 'mais', props: { texto: 'mais' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } }),
    P('entrada/texto', { id: 'campo', props: { valor: '{estado.nome}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'nome', valor: 'evento' }] } }),
    P('midia/imagem', { props: { src: '{estado.url}', alt: 'x' } }),
    P('nav/link', { props: { href: '/x' }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'dentro' } })] } }),
    P('texto/paragrafo', { props: { texto: 'fixo' } }),
  ] } }), { estado: {
    nome: { tipo: 'texto', inicial: "Sol & 'Lua'" }, n: { tipo: 'inteiro', inicial: 2 }, mostra: { tipo: 'booleano', inicial: true }, url: { tipo: 'texto', inicial: '' },
    itens: { tipo: 'json', inicial: [{ id: 1, nome: 'pão', preco: 5.5 }, { id: 2, nome: '<b>', preco: null }] },
  } })

  const servidor = (pg: Programa, semente: Record<string, unknown> = {}) => {
    const h = compilaHtmlVivo(pg)
    if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    return h.pagina.render(semente).corpo
  }
  const todos = (raiz: Node): Node[] => { const r: Node[] = []; const anda = (n: Node) => { r.push(n); n.childNodes.forEach(anda) }; raiz.childNodes.forEach(anda); return r }

  it('adota todos os nós (nenhum createElement/createComment) e o DOM fica igual ao do React; depois continua reagindo', () => {
    const pg = pagina()
    const container = document.createElement('div'); document.body.appendChild(container)
    container.innerHTML = servidor(pg)
    const antes = todos(container)
    const criar = { el: document.createElement, com: document.createComment }
    let criados = 0
    document.createElement = ((...a: Parameters<typeof criar.el>) => { criados++; return criar.el.apply(document, a) }) as typeof document.createElement
    document.createComment = ((...a: Parameters<typeof criar.com>) => { criados++; return criar.com.apply(document, a) }) as typeof document.createComment
    let v!: Vivo
    try { v = montaVivo({ programa: pg, container, hidrata: true }) } finally { document.createElement = criar.el; document.createComment = criar.com }
    expect(v.diagnostico().hidratou).toBe(true)
    expect(criados).toBe(0)
    const depois = todos(container)
    expect(depois.length).toBe(antes.length)
    depois.forEach((n, i) => expect(n).toBe(antes[i])) // os MESMOS nós
    expect(doContainer(container)).toBe(oraculo(pg, v))
    // e segue viva
    ;(container.querySelector('#mais') as HTMLElement).click()
    expect(doContainer(container)).toBe(oraculo(pg, v))
    v.despacha({ t: 'estado', nome: 'itens', valor: [{ id: 2, nome: 'dois', preco: 1 }, { id: 3, nome: 'três', preco: 2 }, { id: 1, nome: 'um', preco: 3 }] })
    expect(doContainer(container)).toBe(oraculo(pg, v))
    const campo = container.querySelector('#campo') as HTMLInputElement
    campo.value = 'digitado'; campo.dispatchEvent(new Event('input', { bubbles: true }))
    expect(doContainer(container)).toBe(oraculo(pg, v))
  })

  it('FUZZ: servidor emite o estado S, o cliente adota e aplica ações: sempre igual ao React', () => {
    let s = 7
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const ri = (k: number) => Math.floor(rnd() * k)
    const pg = pagina()
    for (let rodada = 0; rodada < 40; rodada++) {
      const semente = {
        estado: {
          nome: ["x<&>'\"", '', 'ç日😀'][ri(3)], n: ri(5), mostra: rnd() < 0.5, url: ['', '/p', 'javascript:x', 'https://e.com/?a=1&b=2'][ri(4)],
          itens: Array.from({ length: ri(6) }, (_, i) => ({ id: i * 2 + ri(2), nome: `i${i}`, preco: rnd() < 0.3 ? null : i * 1.5 })).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i),
        },
      }
      const container = document.createElement('div'); document.body.appendChild(container)
      container.innerHTML = servidor(pg, semente)
      const v = montaVivo({ programa: pg, container, hidrata: true, ...semente })
      expect(v.diagnostico().hidratou, `rodada ${rodada}`).toBe(true)
      expect(doContainer(container), `rodada ${rodada} (hidratado)`).toBe(oraculo(pg, v))
      for (let passo = 0; passo < 10; passo++) {
        const k = ri(4)
        if (k === 0) v.despacha({ t: 'estado', nome: 'n', valor: ri(9) })
        else if (k === 1) v.despacha({ t: 'estado', nome: 'mostra', valor: rnd() < 0.5 })
        else if (k === 2) v.despacha({ t: 'estado', nome: 'url', valor: ['', '/q', 'javascript:y'][ri(3)] })
        else v.despacha({ t: 'estado', nome: 'itens', valor: Array.from({ length: ri(7) }, () => ({ id: ri(8), nome: `r${ri(5)}`, preco: ri(3) })).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i) })
        expect(doContainer(container), `rodada ${rodada} passo ${passo}`).toBe(oraculo(pg, v))
      }
      v.destroi(); container.remove()
    }
  })

  it('HTML do servidor divergente: avisa, reconstrói tudo no cliente e o resultado continua correto', () => {
    const pg = pagina()
    const container = document.createElement('div'); document.body.appendChild(container)
    container.innerHTML = servidor(pg).replace('<h2', '<h3').replace('</h2>', '</h3>') // servidor "errado"
    const erros: string[] = []
    const v = montaVivo({ programa: pg, container, hidrata: true, onErro: (e) => erros.push(`${e.regra}: ${e.mensagem}`) })
    expect(v.diagnostico().hidratou).toBe(false)
    expect(erros.some((e) => e.startsWith('hidratacao:') && e.includes('esperava <h2>'))).toBe(true)
    expect(doContainer(container)).toBe(oraculo(pg, v))
    v.despacha({ t: 'estado', nome: 'n', valor: 7 })
    expect(doContainer(container)).toBe(oraculo(pg, v))
  })

  it('HTML com nó sobrando ou faltando também diverge (nunca adota pela metade)', () => {
    const pg = pagina()
    for (const quebra of [(h: string) => h + '<p>intruso</p>', (h: string) => h.replace(/<!---->/, ''), (h: string) => h.replace('<p>fixo</p>', '')]) {
      const container = document.createElement('div'); document.body.appendChild(container)
      container.innerHTML = quebra(servidor(pg))
      const erros: string[] = []
      const v = montaVivo({ programa: pg, container, hidrata: true, onErro: (e) => erros.push(e.regra) })
      expect(erros).toContain('hidratacao')
      expect(doContainer(container)).toBe(oraculo(pg, v))
    }
  })
})

describe('mundo fechado: nós estáticos não geram controlador', () => {
  const pagina = () => programa(P('layout/pilha', { slots: { filhos: [
    P('texto/titulo', { props: { texto: 'título fixo' } }),
    P('texto/paragrafo', { props: { texto: 'tenant={tenant.nome} idioma={idioma} q={consulta.q}' } }),
    P('x/cartao', { repetir: { cada: 'estado.fixos', como: 'f' }, props: { titulo: '{f.nome}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: 'rodapé fixo {indice}' } })] } }),
    P('texto/paragrafo', { se: 'estado.mostra', props: { texto: 'dinâmico {estado.n}' } }),
    P('nav/botao', { id: 'b', props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }, { acao: 'definir', estado: 'mostra', valor: '!estado.mostra' }] } }),
  ] } }), { estado: {
    n: { tipo: 'inteiro', inicial: 0 }, mostra: { tipo: 'booleano', inicial: true },
    fixos: { tipo: 'json', inicial: [{ nome: 'a' }, { nome: 'b' }, { nome: 'c' }] }, // nenhuma ação escreve em estado.fixos
  } })

  it('só o que depende de `n` e `mostra` ganha controlador; o resto (inclusive a lista fixa e seu composto) não', () => {
    const pg = pagina()
    const aberto = sobe(pg, { tenant: { nome: 'T' } }).v.diagnostico().controladores
    const container = document.createElement('div')
    const v = montaVivo({ programa: pg, container, tenant: { nome: 'T' }, fechado: true })
    const fechado = v.diagnostico().controladores
    expect(fechado).toBeLessThan(aberto)
    expect(fechado).toBe(3) // a raiz (guarda os filhos dinâmicos), o `se` (estado.mostra) e o parágrafo dinâmico dentro dele
    expect(doContainer(container)).toBe(oraculo(pg, v, { tenant: { nome: 'T' } }))
    ;(container.querySelector('#b') as HTMLElement).click()
    expect(doContainer(container)).toBe(oraculo(pg, v, { tenant: { nome: 'T' } }))
    ;(container.querySelector('#b') as HTMLElement).click()
    expect(doContainer(container)).toBe(oraculo(pg, v, { tenant: { nome: 'T' } }))
  })

  it('despacho externo fora do que a página declara é recusado (a poda depende desse contrato)', () => {
    const erros: string[] = []
    const container = document.createElement('div')
    const v = montaVivo({ programa: pagina(), container, fechado: true, onErro: (e) => erros.push(e.mensagem) })
    const antes = v.store()
    v.despacha({ t: 'estado', nome: 'fixos', valor: [] })
    expect(v.store()).toBe(antes)
    expect(erros[0]).toContain("'fixos' não é alterável")
    v.despacha({ t: 'estado', nome: 'n', valor: 3 }) // este é declarado
    expect(v.store().estado.n).toBe(3)
  })

  it('FUZZ no modo fechado e hidratado: igual ao React', () => {
    let s = 11
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const pg = pagina()
    const h = compilaHtmlVivo(pg)
    if (!h.ok) throw new Error('x')
    for (let r = 0; r < 20; r++) {
      const container = document.createElement('div'); document.body.appendChild(container)
      container.innerHTML = h.pagina.render({ tenant: { nome: 'T' }, consulta: { q: 'a&b' } }).corpo
      const v = montaVivo({ programa: pg, container, hidrata: true, fechado: true, tenant: { nome: 'T' }, consulta: { q: 'a&b' } })
      for (let i = 0; i < 12; i++) {
        if (rnd() < 0.5) (container.querySelector('#b') as HTMLElement).click()
        else v.despacha({ t: 'estado', nome: 'n', valor: Math.floor(rnd() * 9) })
        expect(doContainer(container), `rodada ${r} passo ${i}`).toBe(oraculo(pg, v, { tenant: { nome: 'T' }, consulta: { q: 'a&b' } }))
      }
      v.destroi(); container.remove()
    }
  })
})

describe('mundo fechado: casos de borda da análise de mutabilidade', () => {
  const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms))

  it('composto com props dinâmicas: o modelo interno (que lê props.*) NÃO é estático', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { titulo: '{p.nome}', preco: '{p.preco}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '{estado.nome}' } })] } }),
      P('x/cartao', { props: { titulo: '{estado.nome}', preco: '{estado.n}' } }),
      P('x/cartao', { props: { titulo: 'fixo', preco: 3 } }), // props constantes: aí sim o interno é estático
      P('nav/botao', { props: { texto: 'a' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'nome', valor: "'z'" }, { acao: 'definir', estado: 'n', valor: '1' }, { acao: 'definir', estado: 'itens', valor: '[]' }] } }),
    ] } }), { estado: { nome: { tipo: 'texto', inicial: 'a' }, n: { tipo: 'inteiro', inicial: 0 }, itens: { tipo: 'json', inicial: [{ id: 1, nome: 'um', preco: 1 }] } } })
    const container = document.createElement('div')
    const v = montaVivo({ programa: pg, container, fechado: true })
    const oc = () => canon(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: v.store().estado }).corpo)
    expect(doContainer(container)).toBe(oc())
    v.despacha({ t: 'estado', nome: 'nome', valor: 'novo <&>' }); expect(doContainer(container)).toBe(oc())
    v.despacha({ t: 'estado', nome: 'n', valor: 42 }); expect(doContainer(container)).toBe(oc())
    v.despacha({ t: 'estado', nome: 'itens', valor: [{ id: 1, nome: 'renomeado', preco: 9 }, { id: 2, nome: 'dois', preco: null }] }); expect(doContainer(container)).toBe(oc())
  })

  it('estado escrito só dentro de `depois`/`emErro` de uma ação executar também é mutável', async () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { id: 'msg', props: { texto: '{estado.msg}' } }),
      P('texto/paragrafo', { id: 'st', props: { texto: '{status.loja}|{erros.loja}' } }),
      P('nav/botao', { id: 'b', props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'executar', dados: 'loja', args: {},
        depois: [{ acao: 'definir', estado: 'msg', valor: "'ok:' + resultado.n" }], emErro: [{ acao: 'definir', estado: 'msg', valor: "'erro'" }] }] } }),
    ] } }), { dados: { loja: 'd.loja' }, estado: { msg: { tipo: 'texto', inicial: '' } } })
    let rejeita = false
    const carregador = () => (rejeita ? Promise.reject(new Error('falhou')) : Promise.resolve({ n: 5 }))
    const container = document.createElement('div'); document.body.appendChild(container)
    const v = montaVivo({ programa: pg, container, fechado: true, carregador, dados: { loja: { n: 0 } } })
    const q = () => `${container.querySelector('#msg')!.textContent}|${container.querySelector('#st')!.textContent}`
    ;(container.querySelector('#b') as HTMLElement).click(); expect(q()).toBe('|carregando|'); await espera()
    expect(q()).toBe('ok:5|ok|')
    rejeita = true; ;(container.querySelector('#b') as HTMLElement).click(); await espera()
    expect(q()).toBe('erro|erro|falhou')
    v.destroi()
  })

  it('o modelo guarda histórico (ações, chaves, antes/depois) e os espelhos assinam as mudanças', () => {
    const pg = programa(P('texto/paragrafo', { props: { texto: '{estado.n}' } }), { estado: { n: { tipo: 'inteiro', inicial: 0 } } })
    const v = montaVivo({ programa: pg, container: document.createElement('div'), historico: 2 })
    const vistas: string[] = []
    v.modelo.assina((m) => vistas.push([...m.mudou].sort().join(',')))
    v.despacha({ t: 'estado', nome: 'n', valor: 1 }); v.despacha({ t: 'estado', nome: 'n', valor: 2 }); v.despacha({ t: 'estado', nome: 'n', valor: 3 })
    expect(vistas).toEqual(['estado,estado.n', 'estado,estado.n', 'estado,estado.n'])
    const h = v.modelo.historico()
    expect(h).toHaveLength(2) // anel de 2
    expect(h[0]!.antes.estado.n).toBe(1); expect(h[1]!.depois.estado.n).toBe(3); expect(h[1]!.acoes).toEqual([{ t: 'estado', nome: 'n', valor: 3 }])
    expect(h[1]!.antes.dados).toBe(h[1]!.depois.dados) // o que não mudou é a MESMA referência (compartilhamento estrutural)
  })
})

describe('hidratação: divergências dentro de elementos e marcadores trocados', () => {
  const pg = () => programa(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { se: 'estado.m', props: { texto: 'a' } }), P('layout/linha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'fixo' } })] } })] } }), { estado: { m: { tipo: 'booleano', inicial: true } } })
  const tenta = (altera: (h: string) => string) => {
    const p = pg()
    const h = compilaHtmlVivo(p); if (!h.ok) throw new Error('x')
    const container = document.createElement('div'); document.body.appendChild(container)
    container.innerHTML = altera(h.pagina.render().corpo)
    const erros: string[] = []
    const v = montaVivo({ programa: p, container, hidrata: true, onErro: (e) => erros.push(e.regra) })
    expect(doContainer(container)).toBe(oraculo(p, v))
    return erros
  }
  it('nó sobrando DENTRO de um elemento', () => { expect(tenta((h) => h.replace('<p>fixo</p>', '<p>fixo</p><p>intruso</p>'))).toContain('hidratacao') })
  it('elemento no lugar de um marcador', () => { expect(tenta((h) => h.replace('<!---->', '<span></span>'))).toContain('hidratacao') })
  it('o HTML correto não gera aviso', () => { expect(tenta((h) => h)).toEqual([]) })
})
