// Perfil de CPU do SSR (rode: pnpm perfil). Gera .cpuprofile e imprime o tempo próprio por função.
import { Registry } from '@polaris/schema'
import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listar' } }))
r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { titulo: { type: 'string' }, preco: { type: 'number' }, id: { type: 'integer' } } },
  modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [P('texto/titulo', { props: { texto: '{props.titulo}', nivel: 3 } }), P('texto/paragrafo', { props: { texto: '{props.preco | brl}' } }), P('nav/link', { props: { href: '/p/{props.id}', texto: 'Ver produto' } })] } }) }))
const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', dados: { produtos: 'd.prod' }, raiz: P('layout/pilha', { slots: { filhos: [P('x/cartao', { repetir: { cada: 'produtos', como: 'p' }, props: { titulo: '{p.nome}', preco: '{p.preco}', id: '{p.id}' } })] } }) })))
if (!res.ok) throw new Error('x')
const dados = { produtos: Array.from({ length: 1000 }, (_, i) => ({ id: i, nome: `Produto ${i}`, preco: 10 + i * 1.5 })) }
for (let i = 0; i < 6; i++) renderPaginaHtml({ programa: res.programa, componentes: COMPONENTES_BASE, dados })
const t = performance.now()
for (let i = 0; i < 25; i++) renderPaginaHtml({ programa: res.programa, componentes: COMPONENTES_BASE, dados })
console.log(`25 renders de 1000 cartões: ${((performance.now() - t) / 25).toFixed(1)} ms cada`)
