// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, elegivelVivo, montaVivo, renderPaginaHtml, type Vivo } from '../src/index'
import { VALORES, pagina } from './fixtures-stream'

const pg = pagina()

function canon(n: Node): string {
  if (n.nodeType === 3) return n.textContent!
  if (n.nodeType !== 1) return ''
  const el = n as HTMLElement
  const attrs = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  const filhos: string[] = []; let t = ''
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1) { if (t) { filhos.push(t); t = '' } filhos.push(canon(c)) } }
  if (t) filhos.push(t)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${filhos.join('')}</>`
}
const oraculo = (v: Vivo) => { const s = v.store(); const d = document.createElement('div'); d.innerHTML = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: s.estado, dados: s.dados, status: s.status, erros: s.erros }).corpo; return [...d.childNodes].map(canon).join('') }
const sobe = () => { const c = document.createElement('div'); document.body.appendChild(c); const v = montaVivo({ programa: pg, container: c, dados: { c: VALORES.c } }); return { c, v, igual: (rot = '') => expect([...c.childNodes].map(canon).join(''), rot).toBe(oraculo(v)) } }
const texto = (c: Element) => [...c.querySelectorAll('p, h2, h3, h4, h5')].map((e) => e.textContent).join('|')

describe('fronteiras de streaming no runtime vivo (sem Suspense)', () => {
  it('páginas com streaming agora são elegíveis ao runtime vivo', () => { expect(elegivelVivo(pg).ok).toBe(true) })

  it('começa com esqueletos (igual ao React) e cada dado que chega abre só as fronteiras que dependem dele', () => {
    const { c, v, igual } = sobe()
    igual('inicial')
    expect(texto(c)).toContain('carregando a'); expect(texto(c)).not.toContain('a=A'); expect(v.store().status).toMatchObject({ a: 'carregando', b: 'carregando', d: 'carregando' })
    v.chega([['a', true, VALORES.a]]); igual('chegou a')
    expect(texto(c)).toContain('a=A'); expect(texto(c)).toContain('carregando a e d') // pad precisa de a E d
    v.chega([['d', true, VALORES.d]]); igual('chegou d')
    expect(texto(c)).toContain('a+d=A/D</script><!--x')
    expect(texto(c)).toContain('carregando {x}'.replace('{x}', 'i1')) // lista: ainda espera b (fronteira dentro do repetir)
    v.chega([['b', true, VALORES.b]]); igual('chegou b')
    expect(texto(c)).toContain('i1:B|i2:B'.replace('|', ' ').split(' ')[0]!)
    expect(texto(c)).not.toContain('carregando')
  })

  it('FUZZ: ordem aleatória de chegadas e de falhas — a cada passo o DOM é o do React para o mesmo estado', () => {
    let s = 5
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let r = 0; r < 60; r++) {
      const { v, igual } = sobe()
      const ordem = ['a', 'b', 'd'].sort(() => rnd() - 0.5)
      for (const k of ordem) {
        if (rnd() < 0.3) v.chega([[k, false, `falhou ${k}`]]); else v.chega([[k, true, VALORES[k]]])
        igual(`rodada ${r} depois de ${k}`)
      }
      expect(Object.values(v.store().status)).not.toContain('carregando')
    }
  })

  it('só o que depende do dado se mexe: um parágrafo sem relação nunca é tocado, e a fronteira que não foi aberta não muda', () => {
    const { c, v } = sobe()
    const cab = c.querySelector('#cab')!
    const mut: MutationRecord[] = []
    const ob = new MutationObserver((m) => mut.push(...m)); ob.observe(cab, { subtree: true, childList: true, characterData: true, attributes: true })
    const pad = c.querySelector('#pad') ?? c.querySelector('#esq-ad')!
    const antes = pad.outerHTML
    v.chega([['a', true, VALORES.a]])
    expect(ob.takeRecords()).toHaveLength(0)
    expect((c.querySelector('#esq-ad') ?? pad).outerHTML).toBe(antes) // pad ainda espera d: o mesmo nó de esqueleto, intocado
    ob.disconnect()
  })

  it('fronteira aninhada: o conteúdo externo aparece com o interno ainda em esqueleto, e o interno abre depois', () => {
    const { c, v, igual } = sobe()
    v.chega([['a', true, VALORES.a]]); igual()
    expect(c.querySelector('#ext')).not.toBeNull(); expect(c.querySelector('#esq-int')).not.toBeNull(); expect(c.querySelector('#fixo')).not.toBeNull()
    v.chega([['d', true, VALORES.d]]); igual()
    expect(c.querySelector('#esq-int')).toBeNull(); expect(c.querySelector('#int')!.textContent).toBe('d interno=D</script><!--x')
  })

  it('erro: a fronteira sai do esqueleto e o erro fica disponível; dado que chega depois do erro corrige', () => {
    const { v, igual } = sobe()
    v.chega([['a', false, 'tempo esgotado']]); igual('erro')
    expect(v.store().erros.a).toBe('tempo esgotado')
    v.chega([['a', true, VALORES.a]]); igual('corrigido')
    expect(v.store().erros.a).toBeUndefined(); expect(v.store().status.a).toBe('ok')
  })

  it('dado repetido com o mesmo valor não faz nada (sem trabalho, sem mutações)', () => {
    const { c, v } = sobe()
    v.chega([['a', true, VALORES.a]])
    const ob = new MutationObserver(() => {}); ob.observe(c, { subtree: true, childList: true, characterData: true, attributes: true })
    v.chega([['a', true, VALORES.a]])
    expect(ob.takeRecords()).toHaveLength(0)
    ob.disconnect()
  })
})

describe('esqueleto com dependências próprias', () => {
  it('o esqueleto continua reativo enquanto os dados não chegam (usa estado, não dados em streaming)', async () => {
    const { Registry } = await import('@polaris/schema')
    const { compilaPrograma, registraBase } = await import('../src/index')
    const r = new Registry(); registraBase(r)
    const n = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
    r.registra(n('servico', 'cat', { entidades: {}, operacoes: {} })); r.registra(n('dados', 'd.x', { fonte: { tipo: 'servico', servico: 'cat', operacao: 'x' } }))
    const res = compilaPrograma(r, r.registra(n('pagina', 'esq', { rota: '/', dados: { x: { dados: 'd.x', stream: true } }, estado: { msg: { tipo: 'texto', inicial: 'aguarde' } },
      raiz: { bloco: 'texto/paragrafo', id: 'p', props: { texto: 'x={x.v}' }, esqueleto: { bloco: 'texto/titulo', id: 'e', props: { texto: '{estado.msg}…', nivel: 3 } } } })))
    if (!res.ok) throw new Error(JSON.stringify(res.erros))
    const c = document.createElement('div'); const v = montaVivo({ programa: res.programa, container: c })
    expect(c.querySelector('#e')!.textContent).toBe('aguarde…')
    v.despacha({ t: 'estado', nome: 'msg', valor: 'quase' })
    expect(c.querySelector('#e')!.textContent).toBe('quase…') // o esqueleto reage ao estado
    v.chega([['x', true, { v: 1 }]])
    expect(c.querySelector('#e')).toBeNull(); expect(c.querySelector('#p')!.textContent).toBe('x=1')
  })
})
