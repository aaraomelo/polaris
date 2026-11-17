import { createElement, type CSSProperties } from 'react'
import type { Registry } from '@polaris/schema'
import { registraNativos } from '../ir/nativos'
import type { Componentes } from './tipos'
import { DOCS_BASE } from './base-doc'

// Biblioteca nativa mínima (layout, texto, mídia, link). Serve de base e de prova do contrato;
// a biblioteca completa de blocos é a épica E3. Cada bloco tem schema (registrado no Registry) e implementação.

export { urlSegura } from './url'
import { urlSegura } from './url'

const txt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const tomDe = (p: Record<string, unknown>): string => (typeof p.tom === 'string' && ['neutro', 'sucesso', 'alerta', 'erro'].includes(p.tom) ? p.tom : 'neutro')
const ALINHA: Record<string, CSSProperties['alignItems']> = { inicio: 'flex-start', centro: 'center', fim: 'flex-end', esticar: 'stretch' }

const caixa = (direcao: 'column' | 'row'): Componentes[string] => ({ props, slots, id }) =>
  createElement('div', {
    ...(id ? { id } : {}),
    style: { display: 'flex', flexDirection: direcao, ...(num(props.gap) !== undefined ? { gap: num(props.gap) } : {}), ...(typeof props.alinha === 'string' && ALINHA[props.alinha] ? { alignItems: ALINHA[props.alinha] } : {}) },
  }, slots.filhos)

export const COMPONENTES_BASE: Componentes = {
  'layout/pilha': caixa('column'),
  'layout/linha': caixa('row'),
  'texto/titulo': ({ props, id }) => {
    const n = Math.min(6, Math.max(1, Math.trunc(num(props.nivel) ?? 1)))
    return createElement(`h${n}`, id ? { id } : null, txt(props.texto))
  },
  'texto/paragrafo': ({ props, id }) => createElement('p', id ? { id } : null, txt(props.texto)),
  'midia/imagem': ({ props, id }) => {
    const src = urlSegura(props.src)
    if (!src) return null
    return createElement('img', { ...(id ? { id } : {}), src, alt: txt(props.alt), ...(num(props.largura) !== undefined ? { width: num(props.largura) } : {}), ...(num(props.altura) !== undefined ? { height: num(props.altura) } : {}), loading: 'lazy' })
  },
  'nav/botao': ({ props, on, id }) =>
    createElement('button', { ...(id ? { id } : {}), type: 'button', disabled: props.desabilitado === true, onClick: () => on.aoClicar?.() }, txt(props.texto)),
  'entrada/texto': ({ props, on, id }) =>
    createElement('input', {
      ...(id ? { id } : {}), type: 'text', value: txt(props.valor), placeholder: txt(props.placeholder), disabled: props.desabilitado === true,
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value),
    }),
  'layout/grade': ({ props, slots, id }) => {
    const n = num(props.colunas), gap = num(props.gap)
    const cols = n === undefined ? 2 : Math.min(12, Math.max(1, Math.trunc(n)))
    return createElement('div', { ...(id ? { id } : {}), style: { display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, ...(gap !== undefined ? { gap } : {}) } }, slots.filhos)
  },
  'layout/divisor': ({ id }) => createElement('hr', id ? { id } : null),
  'layout/espacador': ({ props, id }) => createElement('div', { ...(id ? { id } : {}), 'aria-hidden': 'true', style: { height: num(props.tamanho) ?? 8 } }),
  'texto/rotulo': ({ props, id }) => createElement('label', { ...(id ? { id } : {}), ...(typeof props.para === 'string' && props.para ? { htmlFor: props.para } : {}) }, txt(props.texto)),
  'texto/destaque': ({ props, id }) => createElement('strong', id ? { id } : null, txt(props.texto)),
  'texto/pequeno': ({ props, id }) => createElement('small', id ? { id } : null, txt(props.texto)),
  'texto/codigo': ({ props, id }) => createElement('code', id ? { id } : null, txt(props.texto)),
  'lista/lista': ({ props, slots, id }) => createElement(props.ordenada === true ? 'ol' : 'ul', id ? { id } : null, slots.filhos),
  'lista/item': ({ slots, id }) => createElement('li', id ? { id } : null, slots.filhos),
  'tabela/tabela': ({ slots, id }) => createElement('table', id ? { id } : null, slots.filhos),
  'tabela/cabecalho': ({ slots, id }) => createElement('thead', id ? { id } : null, slots.filhos),
  'tabela/corpo': ({ slots, id }) => createElement('tbody', id ? { id } : null, slots.filhos),
  'tabela/linha': ({ slots, id }) => createElement('tr', id ? { id } : null, slots.filhos),
  'tabela/celula': ({ props, slots, id }) => {
    const c = num(props.colunas), l = num(props.linhas)
    return createElement(props.cabecalho === true ? 'th' : 'td', {
      ...(id ? { id } : {}),
      ...(c !== undefined ? { colSpan: Math.min(1000, Math.max(1, Math.trunc(c))) } : {}), ...(l !== undefined ? { rowSpan: Math.min(65534, Math.max(1, Math.trunc(l))) } : {}),
    }, props.texto !== undefined ? txt(props.texto) : slots.filhos)
  },
  'entrada/numero': ({ props, on, id }) =>
    createElement('input', {
      ...(id ? { id } : {}), type: 'number', value: txt(props.valor), placeholder: txt(props.placeholder), disabled: props.desabilitado === true,
      ...(num(props.min) !== undefined ? { min: num(props.min) } : {}), ...(num(props.max) !== undefined ? { max: num(props.max) } : {}), ...(num(props.passo) !== undefined ? { step: num(props.passo) } : {}),
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value === '' ? null : Number(e.target.value)),
    }),
  'entrada/caixa': ({ props, on, id }) =>
    createElement('input', { ...(id ? { id } : {}), type: 'checkbox', checked: props.marcado === true, disabled: props.desabilitado === true, onChange: (e: { target: { checked: boolean } }) => on.aoMudar?.(e.target.checked) }),
  'feedback/selo': ({ props, id }) => createElement('span', { ...(id ? { id } : {}), 'data-tom': tomDe(props) }, txt(props.texto)),
  'feedback/alerta': ({ props, slots, id }) => createElement('div', { ...(id ? { id } : {}), role: 'alert', 'data-tom': tomDe(props) }, slots.filhos),
  'nav/link': ({ props, slots, id }) => {
    const href = urlSegura(props.href)
    const externo = typeof href === 'string' && /^https?:/i.test(href)
    return createElement('a', { ...(id ? { id } : {}), ...(href ? { href } : {}), ...(externo ? { rel: 'noopener noreferrer' } : {}) }, props.texto !== undefined ? txt(props.texto) : slots.filhos)
  },
}

const bloco = (iface: string, spec: object = {}) => ({ kind: 'bloco', id: iface.replace('/', '.'), versao: '1.0.0', estatuto: 'publicado', spec: { interface: iface, ...(DOCS_BASE[iface] ?? {}), ...spec } })

export const BLOCOS_BASE = [
  bloco('layout/pilha', { slots: { filhos: {} }, props: { type: 'object', properties: { gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] } } } }),
  bloco('layout/linha', { slots: { filhos: {} }, props: { type: 'object', properties: { gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] } } } }),
  bloco('texto/titulo', { props: { type: 'object', properties: { texto: { type: 'string' }, nivel: { type: 'integer', minimum: 1, maximum: 6, default: 1 } }, required: ['texto'] } }),
  bloco('texto/paragrafo', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('midia/imagem', { props: { type: 'object', properties: { src: { type: 'string' }, alt: { type: 'string' }, largura: { type: 'number', minimum: 1 }, altura: { type: 'number', minimum: 1 } }, required: ['src'] } }),
  bloco('nav/botao', { props: { type: 'object', properties: { texto: { type: 'string' }, desabilitado: { type: 'boolean' } }, required: ['texto'] }, eventos: { aoClicar: {} } }),
  bloco('entrada/texto', { props: { type: 'object', properties: { valor: { type: 'string' }, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('layout/grade', { slots: { filhos: {} }, props: { type: 'object', properties: { colunas: { type: 'integer', minimum: 1, maximum: 12, default: 2 }, gap: { type: 'number', minimum: 0 } } } }),
  bloco('layout/divisor'),
  bloco('layout/espacador', { props: { type: 'object', properties: { tamanho: { type: 'number', minimum: 0, default: 8 } } } }),
  bloco('texto/rotulo', { props: { type: 'object', properties: { texto: { type: 'string' }, para: { type: 'string' } }, required: ['texto'] } }),
  bloco('texto/destaque', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('texto/pequeno', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('texto/codigo', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('lista/lista', { slots: { filhos: { aceita: ['lista/item'] } }, props: { type: 'object', properties: { ordenada: { type: 'boolean', default: false } } } }),
  bloco('lista/item', { slots: { filhos: {} } }),
  bloco('tabela/tabela', { slots: { filhos: { aceita: ['tabela/cabecalho', 'tabela/corpo'] } } }),
  bloco('tabela/cabecalho', { slots: { filhos: { aceita: ['tabela/linha'] } } }),
  bloco('tabela/corpo', { slots: { filhos: { aceita: ['tabela/linha'] } } }),
  bloco('tabela/linha', { slots: { filhos: { aceita: ['tabela/celula'] } } }),
  bloco('tabela/celula', { slots: { filhos: {} }, props: { type: 'object', properties: { texto: { type: 'string' }, cabecalho: { type: 'boolean', default: false }, colunas: { type: 'integer', minimum: 1, maximum: 1000 }, linhas: { type: 'integer', minimum: 1, maximum: 65534 } } } }),
  bloco('entrada/numero', { props: { type: 'object', properties: { valor: { type: ['number', 'string'] }, min: { type: 'number' }, max: { type: 'number' }, passo: { type: 'number' }, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'decimal' } } }),
  bloco('entrada/caixa', { props: { type: 'object', properties: { marcado: { type: 'boolean' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'booleano' } } }),
  bloco('feedback/selo', { props: { type: 'object', properties: { texto: { type: 'string' }, tom: { enum: ['neutro', 'sucesso', 'alerta', 'erro'], default: 'neutro' } }, required: ['texto'] } }),
  bloco('feedback/alerta', { slots: { filhos: {} }, props: { type: 'object', properties: { tom: { enum: ['neutro', 'sucesso', 'alerta', 'erro'], default: 'neutro' } } } }),
  bloco('nav/link', { slots: { filhos: {} }, props: { type: 'object', properties: { href: { type: 'string' }, texto: { type: 'string' } }, required: ['href'] } }),
]

/** Registra no Registry o core/slot e os blocos base. */
export function registraBase(reg: Registry): void {
  registraNativos(reg)
  for (const b of BLOCOS_BASE) reg.registra(structuredClone(b))
}
