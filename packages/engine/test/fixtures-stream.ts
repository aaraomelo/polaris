import { Registry } from '@polaris/schema'
import { compilaPrograma, registraBase, type Programa } from '../src/index'

export const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
export const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const fb = (texto: string, id?: string) => P('texto/paragrafo', { ...(id ? { id } : {}), props: { texto } })
/** esqueleto de ESTRUTURA diferente do conteúdo (um título): se o HTML do servidor e o estado do cliente discordarem, a hidratação não consegue adotar e reconstrói (hidratou = false) */
const esq = (texto: string, nivel: number, id?: string) => P('texto/titulo', { ...(id ? { id } : {}), props: { texto, nivel } })

/** A página: dados bloqueante (c) e três em streaming — a e d só em fronteiras do escopo da PÁGINA, b também dentro de um repetir (fronteira que o servidor não consegue trocar sozinho). */
export function pagina(): Programa {
  const r = new Registry(); registraBase(r)
  r.registra(no('servico', 'cat', { entidades: {}, operacoes: {} }))
  for (const x of ['a', 'b', 'c', 'd']) r.registra(no('dados', `d.${x}`, { fonte: { tipo: 'servico', servico: 'cat', operacao: x } }))
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', slots: { rodape: {} }, props: { type: 'object', properties: { t: { type: 'string' } } },
    modelo: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: '{props.t}', nivel: 3 } }), P('core/slot', { props: { nome: 'rodape' } })] } }) }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'stream', { rota: '/', titulo: 'T {c.n}',
    dados: { c: 'd.c', a: { dados: 'd.a', stream: true }, b: { dados: 'd.b', stream: true }, d: { dados: 'd.d', stream: true } },
    raiz: P('layout/pilha', { slots: { filhos: [
      fb('c={c.n}', 'cab'),
      { ...fb('a={a.v}', 'pa'), esqueleto: esq('carregando a', 4, 'esq-a') },
      { ...fb('b página={b.v}', 'pb'), esqueleto: esq('carregando b página', 4, 'esq-pb') },
      { ...fb('a+d={a.v}/{d.v}', 'pad'), esqueleto: esq('carregando a e d', 4, 'esq-ad') },
      { ...P('layout/pilha', { id: 'ext', slots: { filhos: [{ ...fb('d interno={d.v}', 'int'), esqueleto: esq('carregando d interno', 5, 'esq-int') }, fb('fixo dentro', 'fixo')] } }), props: { gap: '{a.n}' } },
      P('layout/pilha', { id: 'lista', repetir: { cada: 'c.itens', como: 'x' }, slots: { filhos: [{ ...fb('{x}:{b.v}', 'item'), esqueleto: esq('carregando {x}', 4) }] } }),
      { ...P('x/cartao', { id: 'cartao', props: { t: '{d.v}' }, slots: { rodape: [{ ...fb('rodapé {a.v}', 'rod'), esqueleto: esq('carregando rodapé', 5, 'esq-rod') }] } }), esqueleto: fb('carregando cartão', 'esq-cartao') },
    ] } }) })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}


export const VALORES: Record<string, unknown> = { a: { v: 'A', n: 3 }, b: { v: 'B' }, c: { n: 1, itens: ['i1', 'i2'] }, d: { v: 'D</script><!--x' } }
