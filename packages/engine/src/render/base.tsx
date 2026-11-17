import { createElement, type CSSProperties } from 'react'
import type { Registry } from '@polaris/schema'
import { registraNativos } from '../ir/nativos'
import type { Componentes } from './tipos'

// Biblioteca nativa mínima (layout, texto, mídia, link). Serve de base e de prova do contrato;
// a biblioteca completa de blocos é a épica E3. Cada bloco tem schema (registrado no Registry) e implementação.

export { urlSegura } from './url'
import { urlSegura } from './url'

const txt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
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
  'nav/link': ({ props, slots, id }) => {
    const href = urlSegura(props.href)
    const externo = typeof href === 'string' && /^https?:/i.test(href)
    return createElement('a', { ...(id ? { id } : {}), ...(href ? { href } : {}), ...(externo ? { rel: 'noopener noreferrer' } : {}) }, props.texto !== undefined ? txt(props.texto) : slots.filhos)
  },
}

const bloco = (iface: string, spec: object = {}) => ({ kind: 'bloco', id: iface.replace('/', '.'), versao: '1.0.0', estatuto: 'publicado', spec: { interface: iface, ...spec } })

export const BLOCOS_BASE = [
  bloco('layout/pilha', { slots: { filhos: {} }, props: { type: 'object', properties: { gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] } } } }),
  bloco('layout/linha', { slots: { filhos: {} }, props: { type: 'object', properties: { gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] } } } }),
  bloco('texto/titulo', { props: { type: 'object', properties: { texto: { type: 'string' }, nivel: { type: 'integer', minimum: 1, maximum: 6 } }, required: ['texto'] } }),
  bloco('texto/paragrafo', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('midia/imagem', { props: { type: 'object', properties: { src: { type: 'string' }, alt: { type: 'string' }, largura: { type: 'number', minimum: 1 }, altura: { type: 'number', minimum: 1 } }, required: ['src'] } }),
  bloco('nav/botao', { props: { type: 'object', properties: { texto: { type: 'string' }, desabilitado: { type: 'boolean' } }, required: ['texto'] }, eventos: { aoClicar: {} } }),
  bloco('entrada/texto', { props: { type: 'object', properties: { valor: { type: 'string' }, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('nav/link', { slots: { filhos: {} }, props: { type: 'object', properties: { href: { type: 'string' }, texto: { type: 'string' } }, required: ['href'] } }),
]

/** Registra no Registry o core/slot e os blocos base. */
export function registraBase(reg: Registry): void {
  registraNativos(reg)
  for (const b of BLOCOS_BASE) reg.registra(structuredClone(b))
}
