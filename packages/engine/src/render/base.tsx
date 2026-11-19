import { createElement, type CSSProperties } from 'react'
import type { Registry } from '@polaris/schema'
import { registraNativos } from '../ir/nativos'
import type { Componentes } from './tipos'
import { DOCS_BASE } from './base-doc'
import { QUADRO_MAX, PULA, arquivoEscolhido, arquivoRecusado, idFormulario, valoresIniciaisJson, dimensao, entradasJson, ident } from '../vivo/blocos'

// Biblioteca nativa mínima (layout, texto, mídia, link). Serve de base e de prova do contrato;
// a biblioteca completa de blocos é a épica E3. Cada bloco tem schema (registrado no Registry) e implementação.

export { urlSegura } from './url'
import { cssUrl, urlSegura } from './url'

const txt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
/** nome acessível do campo (`aria-label`): sem ele o campo só tem nome se houver um `texto/rotulo` ligado por `para`/`id` */
const rotuloDe = (props: Record<string, unknown>): Record<string, string> => (typeof props.rotulo === 'string' && props.rotulo.trim() ? { 'aria-label': props.rotulo.trim().slice(0, 200) } : {})
const ROTULO = { type: 'string', maxLength: 200, description: 'nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para`' }
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
    return createElement('img', { ...(id ? { id } : {}), src, alt: txt(props.alt), ...(num(props.largura) !== undefined ? { width: num(props.largura) } : {}), ...(num(props.altura) !== undefined ? { height: num(props.altura) } : {}), loading: 'lazy', style: { maxWidth: '100%', height: 'auto' } })
  },
  'computacao/canvas-gl': ({ props, id }) => (ident(props.kernel) ? createElement('canvas', { ...(id ? { id } : {}), width: dimensao(props.largura), height: dimensao(props.altura), role: 'img', 'aria-label': txt(props.alt), 'data-polaris-kernel': ident(props.kernel), 'data-polaris-entradas': entradasJson(props.entradas) }, txt(props.alt)) : null),
  'entrada/area': ({ props, on, id }) =>
    createElement('textarea', {
      ...(id ? { id } : {}), ...rotuloDe(props), value: txt(props.valor), placeholder: txt(props.placeholder), rows: Math.min(40, Math.max(1, Math.trunc(num(props.linhas) ?? 4))), disabled: props.desabilitado === true, spellCheck: false,
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value),
    }),
  'midia/quadro': ({ props, id }) => createElement('iframe', { ...(id ? { id } : {}), sandbox: '', title: txt(props.titulo).slice(0, 200), srcDoc: txt(props.html).slice(0, QUADRO_MAX), referrerPolicy: 'no-referrer', style: { width: '100%', height: Math.min(4000, Math.max(40, Math.trunc(num(props.altura) ?? 320))), border: 0 } }),
  'form/formulario': ({ props, id }) => {
    const f = idFormulario(props.formulario); if (!f) return null
    const valores = valoresIniciaisJson(props.valores), idioma = typeof props.idioma === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(props.idioma) ? props.idioma : ''
    return createElement('div', { ...(id ? { id } : {}), 'data-polaris-formulario': f, ...(valores ? { 'data-polaris-valores': valores } : {}), ...(idioma ? { 'data-polaris-idioma': idioma } : {}), role: 'group', 'aria-busy': 'true' }, 'Carregando formulário…')
  },
  'nav/botao': ({ props, on, id }) =>
    createElement('button', { ...(id ? { id } : {}), type: 'button', disabled: props.desabilitado === true, onClick: () => on.aoClicar?.() }, txt(props.texto)),
  'entrada/texto': ({ props, on, id }) =>
    createElement('input', {
      ...(id ? { id } : {}), type: 'text', ...rotuloDe(props), value: txt(props.valor), placeholder: txt(props.placeholder), disabled: props.desabilitado === true,
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value),
    }),
  'layout/grade': ({ props, slots, id }) => {
    const n = num(props.colunas), gap = num(props.gap)
    const cols = n === undefined ? 2 : Math.min(12, Math.max(1, Math.trunc(n)))
    return createElement('div', { ...(id ? { id } : {}), style: { display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, ...(gap !== undefined ? { gap } : {}) } }, slots.filhos)
  },
  'layout/cabecalho': ({ props, slots, id }) => createElement('header', { ...(id ? { id } : {}), ...(props.fixo === true ? { 'data-fixo': '' } : {}) }, slots.filhos),
  'nav/menu': ({ props, slots, id }) => createElement('nav', { ...(id ? { id } : {}), 'aria-label': typeof props.rotulo === 'string' && props.rotulo ? props.rotulo : 'Principal' }, slots.filhos),
  'entrada/arquivo': ({ props, on, id }) =>
    createElement('input', {
      ...(id ? { id } : {}), type: 'file', ...rotuloDe(props), ...(typeof props.aceita === 'string' && props.aceita ? { accept: props.aceita.slice(0, 200) } : {}), disabled: props.desabilitado === true,
      'data-max': String(Math.min(8388608, Math.max(1024, Math.trunc(num(props.tamanhoMax) ?? 2097152)))),
      onChange: (e: { target: HTMLInputElement }) => { const ev = e as unknown as Event; void Promise.resolve(arquivoRecusado(ev)).then((v) => { if (v !== PULA) on.aoRecusar?.(v) }); void Promise.resolve(arquivoEscolhido(ev)).then((v) => { if (v !== PULA) on.aoEscolher?.(v) }) },
    }),
  'layout/destaque': ({ props, slots, id }) => {
    const img = urlSegura(props.imagem), a = Math.min(800, Math.max(120, Math.trunc(num(props.altura) ?? 320))), e = Math.min(0.8, Math.max(0, num(props.escurece) ?? 0.45))
    return createElement('section', { ...(id ? { id } : {}), 'data-alinha': props.alinha === 'esquerda' ? 'esquerda' : 'centro', 'data-fundo': props.fundo === 'suave' ? 'suave' : 'primaria', style: { minHeight: a, ...(img ? { backgroundImage: `linear-gradient(rgba(0,0,0,${e}),rgba(0,0,0,${e})),${cssUrl(img)}` } : {}) } }, slots.filhos)
  },
  'layout/rodape': ({ slots, id }) => createElement('footer', id ? { id } : null, slots.filhos),
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
      ...(id ? { id } : {}), type: 'number', ...rotuloDe(props), value: txt(props.valor), placeholder: txt(props.placeholder), disabled: props.desabilitado === true,
      ...(num(props.min) !== undefined ? { min: num(props.min) } : {}), ...(num(props.max) !== undefined ? { max: num(props.max) } : {}), ...(num(props.passo) !== undefined ? { step: num(props.passo) } : {}),
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value === '' ? null : Number(e.target.value)),
    }),
  'entrada/caixa': ({ props, on, id }) =>
    createElement('input', { ...(id ? { id } : {}), type: 'checkbox', ...rotuloDe(props), checked: props.marcado === true, disabled: props.desabilitado === true, onChange: (e: { target: { checked: boolean } }) => on.aoMudar?.(e.target.checked) }),
  'feedback/selo': ({ props, id }) => createElement('span', { ...(id ? { id } : {}), 'data-tom': tomDe(props) }, txt(props.texto)),
  'feedback/alerta': ({ props, slots, id }) => createElement('div', { ...(id ? { id } : {}), role: 'alert', 'data-tom': tomDe(props) }, slots.filhos),
  'nav/link': ({ props, slots, id }) => {
    const href = urlSegura(props.href)
    const externo = typeof href === 'string' && /^https?:/i.test(href)
    return createElement('a', { ...(id ? { id } : {}), ...(href ? { href } : {}), ...(externo ? { rel: 'noopener noreferrer' } : {}), ...(props.atual === true ? { 'aria-current': 'page' } : {}), ...(props.botao === 'primario' || props.botao === 'secundario' ? { 'data-botao': props.botao } : {}) }, props.texto !== undefined ? txt(props.texto) : slots.filhos)
  },
}

const bloco = (iface: string, spec: object = {}) => ({ kind: 'bloco', id: iface.replace('/', '.'), versao: '1.0.0', estatuto: 'publicado', spec: { interface: iface, ...(DOCS_BASE[iface] ?? {}), ...spec } })

export const BLOCOS_BASE = [
  bloco('layout/pilha', { slots: { filhos: {} }, props: { type: 'object', properties: { gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] } } } }),
  bloco('layout/linha', { slots: { filhos: {} }, props: { type: 'object', properties: { gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] } } } }),
  bloco('texto/titulo', { props: { type: 'object', properties: { texto: { type: 'string' }, nivel: { type: 'integer', minimum: 1, maximum: 6, default: 1 } }, required: ['texto'] } }),
  bloco('texto/paragrafo', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('midia/imagem', { props: { type: 'object', properties: { src: { type: 'string' }, alt: { type: 'string' }, largura: { type: 'number', minimum: 1 }, altura: { type: 'number', minimum: 1 } }, required: ['src'] } }),
  bloco('computacao/canvas-gl', { props: { type: 'object', properties: { kernel: { type: 'string', pattern: '^[a-z][A-Za-z0-9._-]{0,63}$', description: 'id do nó kernel (o artefato é servido em /kernels/<id>.json)' }, largura: { type: 'integer', minimum: 1, maximum: 2048, default: 300 }, altura: { type: 'integer', minimum: 1, maximum: 2048, default: 300 }, alt: { type: 'string' }, entradas: { type: 'object', description: 'valores das entradas escalares do kernel (número ou booleano)' } }, required: ['kernel', 'alt'] } }),
  bloco('entrada/area', { props: { type: 'object', properties: { valor: { type: 'string' }, rotulo: ROTULO, placeholder: { type: 'string' }, linhas: { type: 'integer', minimum: 1, maximum: 40, default: 4 }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('midia/quadro', { props: { type: 'object', properties: { html: { type: 'string', maxLength: 262144, description: 'documento HTML completo a exibir' }, titulo: { type: 'string', maxLength: 200, description: 'nome acessível do quadro (obrigatório)' }, altura: { type: 'integer', minimum: 40, maximum: 4000, default: 320 } }, required: ['html', 'titulo'] } }),
  bloco('form/formulario', { props: { type: 'object', properties: { formulario: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,127}$', description: 'id do nó `formulario` (do tenant ou da plataforma)' }, valores: { type: 'object', description: 'valores iniciais por campo (edição); só primitivos e listas deles' }, idioma: { type: 'string', pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$', description: 'idioma das mensagens (padrão: o do visitante)' } }, required: ['formulario'] }, eventos: { aoEnviado: { payload: 'json' }, aoErro: { payload: 'json' } } }),
  bloco('nav/botao', { props: { type: 'object', properties: { texto: { type: 'string' }, desabilitado: { type: 'boolean' } }, required: ['texto'] }, eventos: { aoClicar: {} } }),
  bloco('entrada/texto', { props: { type: 'object', properties: { valor: { type: 'string' }, rotulo: ROTULO, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('layout/grade', { slots: { filhos: {} }, props: { type: 'object', properties: { colunas: { type: 'integer', minimum: 1, maximum: 12, default: 2 }, gap: { type: 'number', minimum: 0 } } } }),
  bloco('layout/cabecalho', { slots: { filhos: {} }, props: { type: 'object', properties: { fixo: { type: 'boolean', default: false } } } }),
  bloco('nav/menu', { slots: { filhos: {} }, props: { type: 'object', properties: { rotulo: { type: 'string', maxLength: 80 } } } }),
  bloco('entrada/arquivo', { props: { type: 'object', properties: { rotulo: ROTULO, aceita: { type: 'string', maxLength: 200, description: 'tipos aceitos pelo seletor (atributo accept), ex.: image/png,image/jpeg' }, tamanhoMax: { type: 'integer', minimum: 1024, maximum: 8388608, default: 2097152, description: 'bytes; acima disso o evento traz `erro` e o arquivo nem é lido' }, desabilitado: { type: 'boolean' } } }, eventos: { aoEscolher: { payload: 'json' }, aoRecusar: { payload: 'json' } } }),
  bloco('layout/destaque', { slots: { filhos: {} }, props: { type: 'object', properties: { imagem: { type: 'string', maxLength: 500, description: 'URL segura (mesma origem: o CSP das páginas só carrega imagens do próprio site)' }, altura: { type: 'number', minimum: 120, maximum: 800, default: 320, description: 'altura mínima em px' }, escurece: { type: 'number', minimum: 0, maximum: 0.8, default: 0.45, description: 'véu escuro sobre a imagem, para o texto ler' }, alinha: { type: 'string', description: 'centro (padrão) ou esquerda (outro valor vale centro)' }, fundo: { type: 'string', description: 'sem imagem: primaria (padrão) ou suave (outro valor vale primaria)' } } } }),
  bloco('layout/rodape', { slots: { filhos: {} } }),
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
  bloco('entrada/numero', { props: { type: 'object', properties: { valor: { type: ['number', 'string'] }, rotulo: ROTULO, min: { type: 'number' }, max: { type: 'number' }, passo: { type: 'number' }, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'decimal' } } }),
  bloco('entrada/caixa', { props: { type: 'object', properties: { marcado: { type: 'boolean' }, rotulo: ROTULO, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'booleano' } } }),
  bloco('feedback/selo', { props: { type: 'object', properties: { texto: { type: 'string' }, tom: { enum: ['neutro', 'sucesso', 'alerta', 'erro'], default: 'neutro' } }, required: ['texto'] } }),
  bloco('feedback/alerta', { slots: { filhos: {} }, props: { type: 'object', properties: { tom: { enum: ['neutro', 'sucesso', 'alerta', 'erro'], default: 'neutro' } } } }),
  bloco('nav/link', { slots: { filhos: {} }, props: { type: 'object', properties: { href: { type: 'string' }, texto: { type: 'string' }, botao: { type: 'string', maxLength: 12, description: 'primario ou secundario: o link com aparência de botão' }, atual: { type: 'boolean', description: 'a página atual: o link leva aria-current="page"' } }, required: ['href'] } }),
]

/** Registra no Registry o core/slot e os blocos base. */
export function registraBase(reg: Registry): void {
  registraNativos(reg)
  for (const b of BLOCOS_BASE) reg.registra(structuredClone(b))
}
