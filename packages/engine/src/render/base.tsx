import { createElement, type CSSProperties } from 'react'
import type { Registry } from '@polaris/schema'
import { registraNativos } from '../ir/nativos'
import type { Componentes } from './tipos'
import { DOCS_BASE } from './base-doc'
import { corDoTom, formaSvg } from '../vivo/svg'
import { estadoPainel, modoDe, BASE_PARAGRAFO, BASE_SOBRETITULO, baseTitulo, estiloEscalaObj, marcaDe, proporcaoDaImagem, QUADRO_MAX, PULA, arquivoEscolhido, arquivoRecusado, idFormulario, valoresIniciaisJson, dimensao, entradasJson, ident } from '../vivo/blocos'

// Biblioteca nativa mínima (layout, texto, mídia, link). Serve de base e de prova do contrato;
// a biblioteca completa de blocos é a épica E3. Cada bloco tem schema (registrado no Registry) e implementação.

export { urlSegura } from './url'
import { NOMES_ICONES } from '../icones/nomes'
import { atributosDaTela, proporcaoDe } from '../tela/atributos'
import { caminhoLocal, cssUrl, idDeElemento, nomeDeIcone, nomeDeParametro, tamanhoDeIcone, sugestoesAoVivo, srcsetDe, tamanhosDe, urlSegura } from './url'

const txt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
/** nome acessível do campo (`aria-label`): sem ele o campo só tem nome se houver um `texto/rotulo` ligado por `para`/`id` */
const rotuloDe = (props: Record<string, unknown>): Record<string, string> => (typeof props.rotulo === 'string' && props.rotulo.trim() ? { 'aria-label': props.rotulo.trim().slice(0, 200) } : {})
const ICONE_PROP = { type: 'string', description: 'ícone da família Grafite antes do texto (nomes em `midia/icone`); aceita um valor de dado; um nome que não existe não pinta nada' }
const ICONE_APOS = { type: 'boolean', description: 'o ícone vem DEPOIS do texto (uma seta de "ver mais"); com texto vazio, é um botão só de ícone (dê um `rotulo`)' }
const MARCA = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$', description: 'gancho de estilo: vira data-marca, que o CSS do tema usa' }
const ROTULO = { type: 'string', maxLength: 200, description: 'nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para`' }
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const tomDe = (p: Record<string, unknown>): string => (typeof p.tom === 'string' && ['neutro', 'sucesso', 'alerta', 'erro'].includes(p.tom) ? p.tom : 'neutro')
const ALINHA: Record<string, CSSProperties['alignItems']> = { inicio: 'flex-start', centro: 'center', fim: 'flex-end', esticar: 'stretch' }

/** `papel` (toolbar, group ou list) e `rotulo` de uma caixa: dão ao grupo de itens um nome e um papel para leitores de tela e para o teclado */
const PAPEIS_CAIXA = ['toolbar', 'group', 'list', 'status'] as const
const papelDe = (props: Record<string, unknown>): Record<string, string> => ({ ...((PAPEIS_CAIXA as readonly unknown[]).includes(props.papel) ? { role: props.papel as string } : {}), ...(typeof props.rotulo === 'string' && props.rotulo.trim() ? { 'aria-label': props.rotulo.trim().slice(0, 200) } : {}) })
/** `largura` (px, 40 a 2000) fixa a largura da caixa dentro de uma linha; `cresce` faz ela ocupar o espaço que sobra (sem estourar) */
const larguraDe = (v: unknown): string | undefined => (typeof v === 'number' && Number.isFinite(v) ? `${Math.min(2000, Math.max(40, Math.round(v)))}px` : undefined)
const caixa = (direcao: 'column' | 'row'): Componentes[string] => ({ props, slots, id }) =>
  createElement('div', {
    ...(id ? { id } : {}), ...papelDe(props), ...(props.solta === true ? { 'data-solta': '' } : {}), ...(props.recorta === true ? { 'data-recorta': '' } : {}), ...(marcaDe(props) ? { 'data-marca': marcaDe(props)! } : {}), ...(modoDe(props) ? { 'data-modo': modoDe(props)! } : {}),
    style: { display: 'flex', flexDirection: direcao, ...(num(props.gap) !== undefined ? { gap: num(props.gap) } : {}), ...(typeof props.alinha === 'string' && ALINHA[props.alinha] ? { alignItems: ALINHA[props.alinha] } : {}), ...(props.quebra === true ? { flexWrap: 'wrap' } : {}), ...(larguraDe(props.largura) ? { width: larguraDe(props.largura), flex: 'none' } : {}), ...(props.cresce === true ? { flex: '1 1 0%', minWidth: 0 } : {}) },
  }, slots.filhos)

export const COMPONENTES_BASE: Componentes = {
  'layout/pilha': caixa('column'),
  'layout/linha': caixa('row'),
  'texto/titulo': ({ props, slots, id }) => {
    const n = Math.min(6, Math.max(1, Math.trunc(num(props.nivel) ?? 1)))
    return createElement(`h${n}`, { ...(id ? { id } : {}), ...(props.tamanho === 'grande' || props.tamanho === 'medio' ? { 'data-tamanho': props.tamanho } : {}), ...(estiloEscalaObj(props, baseTitulo(n)) ? { style: estiloEscalaObj(props, baseTitulo(n)) } : {}) }, props.texto === undefined || props.texto === '' ? slots.filhos : txt(props.texto))
  },
  'texto/trecho': ({ props, id }) => createElement('span', id ? { id } : null, txt(props.texto)),
  'texto/enfase': ({ props, id }) => createElement('em', { ...(id ? { id } : {}), ...(props.bloco === true ? { style: { display: 'block' } } : {}) }, txt(props.texto)),
  'texto/paragrafo': ({ props, id }) => createElement('p', { ...(id ? { id } : {}), ...(estiloEscalaObj(props, BASE_PARAGRAFO) || corDoTom(props) ? { style: { ...(estiloEscalaObj(props, BASE_PARAGRAFO) ?? {}), ...(corDoTom(props) ? { color: corDoTom(props) } : {}) } } : {}) }, txt(props.texto)),
  'midia/imagem': ({ props, id }) => {
    const src = urlSegura(props.src)
    if (!src) return null
    const sz = tamanhosDe(props.tamanhos, num(props.largura)), ss = sz ? srcsetDe(src) : undefined // sem `tamanhos` nem `largura` o navegador não sabe o espaço da imagem: sem srcset
    return createElement('img', { ...(id ? { id } : {}), src, ...(ss ? { srcSet: ss, sizes: sz } : {}), alt: txt(props.alt), ...(num(props.largura) !== undefined ? { width: num(props.largura) } : {}), ...(num(props.altura) !== undefined ? { height: num(props.altura) } : {}), loading: 'lazy', style: { maxWidth: '100%', height: 'auto', ...(props.fluida === true || (proporcaoDaImagem(props) && num(props.largura) === undefined) ? { width: '100%' } : {}), ...(proporcaoDaImagem(props) ? { aspectRatio: proporcaoDaImagem(props), objectFit: 'cover' } : {}) } })
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
    createElement('button', { ...(id ? { id } : {}), type: 'button', disabled: props.desabilitado === true, ...(props.atual === true ? { 'aria-current': 'true' } : {}), ...(props.variante === 'secundario' || props.variante === 'fantasma' ? { 'data-variante': props.variante } : {}), ...(nomeDeIcone(props.icone) ? { 'data-icone': nomeDeIcone(props.icone) } : {}), ...(props.iconeApos === true ? { 'data-icone-apos': '' } : {}), ...rotuloDe(props), ...(typeof props.expandido === 'boolean' ? { 'aria-expanded': props.expandido ? 'true' : 'false' } : {}), ...(typeof props.alvo === 'string' && /^[A-Za-z][\w-]{0,119}$/.test(props.alvo) ? { 'data-alvo': props.alvo } : {}), ...(typeof props.arrasta === 'string' && /^[A-Za-z][\w-]{0,119}$/.test(props.arrasta) ? { draggable: true, 'data-arrasta': props.arrasta } : {}), onClick: () => on.aoClicar?.() }, txt(props.texto)),
  'entrada/texto': ({ props, on, id }) =>
    createElement('input', {
      ...(id ? { id } : {}), type: 'text', ...rotuloDe(props), value: txt(props.valor), placeholder: txt(props.placeholder), disabled: props.desabilitado === true, ...(idDeElemento(props.lista) ? { list: idDeElemento(props.lista) } : {}),
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value),
    }),
  'layout/grade': ({ props, slots, id }) => {
    const n = num(props.colunas), gap = num(props.gap)
    const cols = n === undefined ? 2 : Math.min(12, Math.max(1, Math.trunc(n)))
    return createElement('div', { ...(id ? { id } : {}), ...(marcaDe(props) ? { 'data-marca': marcaDe(props)! } : {}), style: { display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, ...(gap !== undefined ? { gap } : {}), ...(typeof props.alinha === 'string' && ALINHA[props.alinha] ? { alignItems: ALINHA[props.alinha] } : {}) } }, slots.filhos)
  },
  'layout/cabecalho': ({ props, slots, id }) => createElement('header', { ...(id ? { id } : {}), ...(props.fixo === true ? { 'data-fixo': '' } : {}), ...(props.centro === true ? { 'data-centro': '' } : {}) }, slots.filhos),
  'layout/painel': ({ slots, id }) => createElement('div', { ...(id ? { id } : {}), 'data-painel': '' }, slots.filhos),
  'layout/lateral': ({ props, slots, id }) => createElement('aside', { ...(id ? { id } : {}), 'data-lateral': '', ...rotuloDe(props.rotulo === undefined ? { rotulo: 'Navegação lateral' } : props) }, slots.filhos),
  'layout/principal': ({ slots, id }) => createElement('main', { ...(id ? { id } : {}), 'data-principal': '' }, slots.filhos),
  'midia/tela': ({ props, slots, id }) => { const { style: _s, ...attrs } = atributosDaTela(props); return createElement('div', { ...(id ? { id } : {}), ...attrs, style: { aspectRatio: proporcaoDe(props), position: 'relative', width: '100%', ['--proporcao' as string]: proporcaoDe(props) } as CSSProperties }, slots.filhos) },
  'layout/cartao': ({ props, slots, id }) => createElement('div', { ...(id ? { id } : {}), 'data-cartao': '', ...papelDe(props) }, slots.filhos),
  'layout/secao': ({ props, slots, id }) => createElement('details', { ...(id ? { id } : {}), 'data-secao': '', ...(props.aberta === true ? { open: true } : {}) }, slots.filhos),
  'layout/secao-titulo': ({ props, id }) => createElement('summary', { ...(id ? { id } : {}), ...(nomeDeIcone(props.icone) ? { 'data-icone': nomeDeIcone(props.icone) } : {}) }, txt(props.texto)),
  'nav/submenu': ({ slots, id }) => createElement('details', { ...(id ? { id } : {}), 'data-submenu': '' }, slots.filhos),
  'nav/submenu-titulo': ({ props, id }) => createElement('summary', { ...(id ? { id } : {}) }, txt(props.texto)),
  'nav/menu': ({ props, slots, id }) => createElement('nav', { ...(id ? { id } : {}), 'aria-label': typeof props.rotulo === 'string' && props.rotulo ? props.rotulo : 'Principal', ...(marcaDe(props) ? { 'data-marca': marcaDe(props)! } : {}) }, slots.filhos),
  'entrada/selecao': ({ props, slots, on, id }) =>
    createElement('select', {
      ...(id ? { id } : {}), ...rotuloDe(props), value: txt(props.valor), disabled: props.desabilitado === true,
      onChange: (e: { target: { value: string } }) => on.aoMudar?.(e.target.value),
    }, slots.filhos),
  'entrada/opcao': ({ props, id }) => createElement('option', { ...(id ? { id } : {}), value: txt(props.valor) }, txt(props.texto)), // a opção escolhida vem do `value` do seletor
  'nav/alternador': ({ props, id }) => createElement('input', { ...(id ? { id } : {}), type: 'checkbox', role: 'switch', 'data-alternador': '', ...rotuloDe(props.rotulo === undefined ? { rotulo: 'Abrir o menu' } : props) }),
  'form/busca': ({ props, slots, id }) => createElement('form', { ...(id ? { id } : {}), role: 'search', method: 'get', action: caminhoLocal(props.acao) }, slots.filhos),
  'entrada/busca': ({ props, id }) => createElement('input', { ...(id ? { id } : {}), type: 'search', name: nomeDeParametro(props.nome), ...rotuloDe(props.rotulo === undefined ? { rotulo: 'Buscar' } : props), ...(typeof props.placeholder === 'string' && props.placeholder ? { placeholder: props.placeholder } : {}), defaultValue: txt(props.valor).slice(0, 200), maxLength: 200, autoComplete: 'off', ...(idDeElemento(props.lista) ? { list: idDeElemento(props.lista) } : {}) }),
  'form/sugestoes-ao-vivo': ({ props, id }) => { const a = sugestoesAoVivo(props); return a ? createElement('ul', { ...(id ? { id } : {}), role: 'listbox', 'aria-label': typeof props.rotulo === 'string' && props.rotulo.trim() ? props.rotulo.trim().slice(0, 100) : 'Sugestões', hidden: true, ...a }) : null },
  'form/sugestoes': ({ slots, id }) => createElement('datalist', { ...(id ? { id } : {}) }, slots.filhos),
  'form/opcao': ({ props, id }) => createElement('option', { ...(id ? { id } : {}), value: txt(props.valor).slice(0, 100) }),
  'nav/enviar': ({ props, id }) => createElement('button', { ...(id ? { id } : {}), type: 'submit' }, txt(props.texto) || 'Enviar'),
  'entrada/arquivo': ({ props, on, id }) =>
    createElement('input', {
      ...(id ? { id } : {}), type: 'file', ...rotuloDe(props), ...(typeof props.aceita === 'string' && props.aceita ? { accept: props.aceita.slice(0, 200) } : {}), disabled: props.desabilitado === true,
      'data-max': String(Math.min(8388608, Math.max(1024, Math.trunc(num(props.tamanhoMax) ?? 2097152)))),
      onChange: (e: { target: HTMLInputElement }) => { const ev = e as unknown as Event; void Promise.resolve(arquivoRecusado(ev)).then((v) => { if (v !== PULA) on.aoRecusar?.(v) }); void Promise.resolve(arquivoEscolhido(ev)).then((v) => { if (v !== PULA) on.aoEscolher?.(v) }) },
    }),
  'layout/destaque': ({ props, slots, id }) => {
    const img = urlSegura(props.imagem), a = Math.min(800, Math.max(120, Math.trunc(num(props.altura) ?? 320))), e = Math.min(0.8, Math.max(0, num(props.escurece) ?? 0.45))
    return createElement('section', { ...(id ? { id } : {}), 'data-alinha': props.alinha === 'esquerda' ? 'esquerda' : 'centro', 'data-fundo': props.fundo === 'suave' ? 'suave' : 'primaria', ...(img ? { 'data-imagem': '' } : {}), ...(props.capa === true ? { 'data-capa': '' } : {}), ...(props.zoom === true ? { 'data-zoom': '' } : {}), style: { ...(proporcaoDaImagem(props) ? { aspectRatio: String(proporcaoDaImagem(props)), boxSizing: 'border-box' } : { minHeight: props.capa === true ? (a >= 800 ? '100svh' : `min(${a}px,100svh)`) : a }), ...(Math.min(12, Math.max(1, Math.trunc(num(props.ocupa) ?? 0))) && num(props.ocupa) !== undefined ? { gridColumn: `span ${Math.min(12, Math.max(1, Math.trunc(num(props.ocupa)!)))}` } : {}), ...(img ? { backgroundImage: `linear-gradient(rgba(0,0,0,${e}),rgba(0,0,0,${e})),${cssUrl(img)}` } : {}) } }, slots.filhos)
  },
  'layout/contido': ({ props, slots, id }) => createElement('div', { ...(id ? { id } : {}), 'data-contido': props.largura === 'estreita' || props.largura === 'larga' ? props.largura : 'normal' }, slots.filhos),
  'layout/rodape': ({ slots, id }) => createElement('footer', id ? { id } : null, slots.filhos),
  'layout/modal': ({ props, slots, id }) => createElement('div', { ...(id ? { id } : {}), ...estadoPainel(props), 'data-modal': '', role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof props.rotulo === 'string' && props.rotulo.trim() ? props.rotulo.trim().slice(0, 200) : 'Diálogo', ...(typeof props.largura === 'number' && props.largura >= 12 && props.largura <= 80 ? { style: { '--modal-largura': `${Math.round(props.largura * 100) / 100}rem` } } : {}) }, slots.filhos),
  'layout/gaveta': ({ props, slots, id }) => createElement('aside', { ...(id ? { id } : {}), ...estadoPainel(props), 'data-gaveta': props.lado === 'esquerda' ? 'esquerda' : 'direita', role: 'dialog', 'aria-label': typeof props.rotulo === 'string' && props.rotulo.trim() ? props.rotulo.trim().slice(0, 200) : 'Detalhes', ...(typeof props.largura === 'number' && props.largura >= 12 && props.largura <= 80 ? { style: { '--gaveta-largura': `${Math.round(props.largura * 100) / 100}rem` } } : {}) }, slots.filhos),
  'layout/divisor': ({ id }) => createElement('hr', id ? { id } : null),
  ...Object.fromEntries(['grafico/svg', 'grafico/circulo', 'grafico/retangulo', 'grafico/reta', 'grafico/caminho', 'grafico/rotulo'].map((b) => [b, ({ props, slots, id }: { props: Record<string, any>; slots: Record<string, any>; id?: string }) => {
    const f = formaSvg(b, props), attrs: Record<string, unknown> = { ...(id ? { id } : {}), ...f.attrs }
    if ('tabindex' in attrs) { attrs.tabIndex = Number(attrs.tabindex); delete attrs.tabindex }
    return createElement(f.tag.replace(/^svg:/, ''), { ...attrs, ...(Object.keys(f.estilo).length ? { style: f.estilo } : {}) }, ...(b === 'grafico/svg' ? [slots.filhos] : b === 'grafico/rotulo' ? [f.texto] : []))
  }])),
  'layout/espacador': ({ props, id }) => createElement('div', { ...(id ? { id } : {}), 'aria-hidden': 'true', style: { height: num(props.tamanho) ?? 8 } }),
  'texto/rotulo': ({ props, id }) => createElement('label', { ...(id ? { id } : {}), ...(typeof props.para === 'string' && props.para ? { htmlFor: props.para } : {}) }, txt(props.texto)),
  'texto/destaque': ({ props, id }) => createElement('strong', id ? { id } : null, txt(props.texto)),
  'texto/sobretitulo': ({ props, id }) => createElement('p', { ...(id ? { id } : {}), 'data-sobretitulo': '', ...(estiloEscalaObj(props, BASE_SOBRETITULO) || corDoTom(props) ? { style: { ...(estiloEscalaObj(props, BASE_SOBRETITULO) ?? {}), ...(corDoTom(props) ? { color: corDoTom(props) } : {}) } } : {}) }, txt(props.texto)),
  'texto/pequeno': ({ props, id }) => createElement('small', { ...(id ? { id } : {}), ...(corDoTom(props) ? { style: { color: corDoTom(props) } } : {}) }, txt(props.texto)),
  'texto/codigo': ({ props, id }) => createElement('code', id ? { id } : null, txt(props.texto)),
  'lista/lista': ({ props, slots, id }) => createElement(props.ordenada === true ? 'ol' : 'ul', id ? { id } : null, slots.filhos),
  'lista/item': ({ slots, id }) => createElement('li', id ? { id } : null, slots.filhos),
  'tabela/tabela': ({ slots, id }) => createElement('table', id ? { id } : null, slots.filhos),
  'tabela/cabecalho': ({ slots, id }) => createElement('thead', id ? { id } : null, slots.filhos),
  'tabela/corpo': ({ slots, id }) => createElement('tbody', id ? { id } : null, slots.filhos),
  'tabela/linha': ({ props, slots, id }) => createElement('tr', { ...(id ? { id } : {}), ...(props.clicavel === true ? { 'data-clicavel': '' } : {}) }, slots.filhos),
  'tabela/celula': ({ props, slots, id }) => {
    const c = num(props.colunas), l = num(props.linhas)
    return createElement(props.cabecalho === true ? 'th' : 'td', {
      ...(id ? { id } : {}), ...(corDoTom(props) ? { style: { color: corDoTom(props) } } : {}),
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
  'midia/icone': ({ props, id }) => {
    const n = nomeDeIcone(props.nome); if (!n) return null; const t = tamanhoDeIcone(props.tamanho), r = typeof props.rotulo === 'string' && props.rotulo.trim() ? props.rotulo.trim().slice(0, 200) : ''
    return createElement('span', { ...(id ? { id } : {}), 'data-icone': n, ...(props.acento === true ? { 'data-acento': '' } : {}), ...(t ? { style: { '--icone-tamanho': t } } : {}), ...(r ? { role: 'img', 'aria-label': r } : { 'aria-hidden': 'true' }) })
  },
  'nav/link': ({ props, slots, id }) => {
    const href = urlSegura(props.href)
    const externo = typeof href === 'string' && /^https?:/i.test(href)
    return createElement('a', { ...(id ? { id } : {}), ...(href ? { href } : {}), ...(externo ? { rel: 'noopener noreferrer' } : {}), ...(props.atual === true ? { 'aria-current': 'page' } : {}), ...(props.soConsulta === true ? { 'data-consulta': '' } : {}), ...rotuloDe(props), ...(props.botao === 'primario' || props.botao === 'secundario' || props.botao === 'texto' ? { 'data-botao': props.botao } : {}), ...(nomeDeIcone(props.icone) ? { 'data-icone': nomeDeIcone(props.icone) } : {}), ...(props.iconeApos === true ? { 'data-icone-apos': '' } : {}) }, props.texto !== undefined ? txt(props.texto) : slots.filhos)
  },
}

const bloco = (iface: string, spec: object = {}) => ({ kind: 'bloco', id: iface.replace('/', '.'), versao: '1.0.0', estatuto: 'publicado', spec: { interface: iface, ...(DOCS_BASE[iface] ?? {}), ...spec } })

const NUM = { type: 'number' }, COR = { type: 'string', maxLength: 200, description: 'cor CSS segura: var(), color-mix(), oklch(), rgb(), hsl() ou #hex' }, TOM = { type: 'string', description: 'nome da cor do tema (token `grafico.<tom>`)' }
export const BLOCOS_BASE = [
  bloco('layout/pilha', { slots: { filhos: {} }, props: { type: 'object', properties: { papel: { enum: ['toolbar', 'group', 'list', 'status'], description: 'papel ARIA do grupo (barra de ferramentas, grupo, lista ou status: região viva que o leitor de tela anuncia ao mudar)' }, rotulo: { type: 'string', maxLength: 200, description: 'nome acessível do grupo (aria-label)' }, largura: { type: 'number', minimum: 40, maximum: 2000, description: 'largura fixa em px (dentro de uma linha)' }, marca: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$', description: 'gancho de estilo: vira data-marca, que o CSS do tema usa (o cartão de produto usa `cartao-produto`)' }, modo: { type: 'string', description: 'modo do tema (ex.: claro, escuro): os tokens do modo valem dentro desta caixa; troque com um estado para alternar o tema da página' }, recorta: { type: 'boolean', description: 'corta o que passa da caixa (a foto que cresce no hover, com o token movimento.zoomCartao, fica dentro dela)' }, cresce: { type: 'boolean', description: 'ocupa o espaço que sobra na linha (flex 1, sem estourar)' }, gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] }, quebra: { type: 'boolean', description: 'quebra em várias linhas quando falta espaço (flex-wrap)' }, solta: { type: 'boolean', description: 'zona de soltar: itens com `arrasta` (botões) arrastados para dentro dela chegam em `aoSoltar` como `{ valor, alvo, zona }` (zona: antes, dentro ou depois do item sob o ponteiro); a ilha `@polaris/engine/tela` faz o arrastar' } } }, eventos: { aoSoltar: { payload: 'json' } } }),
  bloco('layout/linha', { slots: { filhos: {} }, props: { type: 'object', properties: { papel: { enum: ['toolbar', 'group', 'list', 'status'], description: 'papel ARIA do grupo (barra de ferramentas, grupo, lista ou status: região viva que o leitor de tela anuncia ao mudar)' }, rotulo: { type: 'string', maxLength: 200, description: 'nome acessível do grupo (aria-label)' }, largura: { type: 'number', minimum: 40, maximum: 2000, description: 'largura fixa em px (dentro de uma linha)' }, marca: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$', description: 'gancho de estilo: vira data-marca, que o CSS do tema usa (o cartão de produto usa `cartao-produto`)' }, modo: { type: 'string', description: 'modo do tema (ex.: claro, escuro): os tokens do modo valem dentro desta caixa; troque com um estado para alternar o tema da página' }, recorta: { type: 'boolean', description: 'corta o que passa da caixa (a foto que cresce no hover, com o token movimento.zoomCartao, fica dentro dela)' }, cresce: { type: 'boolean', description: 'ocupa o espaço que sobra na linha (flex 1, sem estourar)' }, gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'] }, quebra: { type: 'boolean', description: 'quebra em várias linhas quando falta espaço (flex-wrap); sem isso a linha pode passar da largura' }, solta: { type: 'boolean', description: 'zona de soltar: itens com `arrasta` (botões) arrastados para dentro dela chegam em `aoSoltar` como `{ valor, alvo, zona }` (zona: antes, dentro ou depois do item sob o ponteiro); a ilha `@polaris/engine/tela` faz o arrastar' } } }, eventos: { aoSoltar: { payload: 'json' } } }),
  bloco('texto/titulo', { slots: { filhos: {} }, props: { type: 'object', properties: { texto: { type: 'string', description: 'o texto do título; vazio ("") faz o título ser montado com os filhos (`texto/trecho`, `texto/enfase`)' }, nivel: { type: 'integer', minimum: 1, maximum: 6, default: 1 }, escala: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,23}$', description: 'escala tipográfica nomeada: lê os tokens do tema `tipografia.escala.<nome>.tamanho|peso|altura|espacamento` (cada um cai no padrão do bloco quando falta)' }, tamanho: { enum: ['grande', 'medio'], description: 'título de seção maior (tokens tipografia.tamanhoGrande e tamanhoMedio)' } }, required: ['texto'] } }),
  bloco('texto/trecho', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('texto/enfase', { props: { type: 'object', properties: { texto: { type: 'string' }, bloco: { type: 'boolean', description: 'a ênfase ocupa a linha inteira (vira uma segunda linha do título)' } }, required: ['texto'] } }),
  bloco('texto/paragrafo', { props: { type: 'object', properties: { texto: { type: 'string' }, tom: { type: 'string', description: 'cor do texto pelo nome do tom do tema (token `grafico.<tom>`)' }, escala: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,23}$', description: 'escala tipográfica nomeada: lê os tokens do tema `tipografia.escala.<nome>.tamanho|peso|altura|espacamento` (cada um cai no padrão do bloco quando falta)' } }, required: ['texto'] } }),
  bloco('midia/imagem', { props: { type: 'object', properties: { src: { type: 'string' }, alt: { type: 'string' }, fluida: { type: 'boolean', description: 'ocupa toda a largura do contêiner (a altura segue a proporção da foto)' }, proporcao: { type: 'number', minimum: 0.2, maximum: 5, description: 'largura ÷ altura (0,8 = retrato 4:5): a imagem preenche a largura e é cortada para essa proporção (object-fit: cover)' }, largura: { type: 'number', minimum: 1 }, altura: { type: 'number', minimum: 1 }, tamanhos: { type: 'string', maxLength: 200 } }, required: ['src'] } }),
  bloco('computacao/canvas-gl', { props: { type: 'object', properties: { kernel: { type: 'string', pattern: '^[a-z][A-Za-z0-9._-]{0,63}$', description: 'id do nó kernel (o artefato é servido em /kernels/<id>.json)' }, largura: { type: 'integer', minimum: 1, maximum: 2048, default: 300 }, altura: { type: 'integer', minimum: 1, maximum: 2048, default: 300 }, alt: { type: 'string' }, entradas: { type: 'object', description: 'valores das entradas escalares do kernel (número ou booleano)' } }, required: ['kernel', 'alt'] } }),
  bloco('entrada/area', { props: { type: 'object', properties: { valor: { type: 'string' }, rotulo: ROTULO, placeholder: { type: 'string' }, linhas: { type: 'integer', minimum: 1, maximum: 40, default: 4 }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('midia/quadro', { props: { type: 'object', properties: { html: { type: 'string', maxLength: 262144, description: 'documento HTML completo a exibir' }, titulo: { type: 'string', maxLength: 200, description: 'nome acessível do quadro (obrigatório)' }, altura: { type: 'integer', minimum: 40, maximum: 4000, default: 320 } }, required: ['html', 'titulo'] } }),
  bloco('form/formulario', { props: { type: 'object', properties: { formulario: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,127}$', description: 'id do nó `formulario` (do tenant ou da plataforma)' }, valores: { type: 'object', description: 'valores iniciais por campo (edição); só primitivos e listas deles' }, idioma: { type: 'string', pattern: '^([a-z]{2,3}(-[A-Za-z0-9]{2,8})?|\\{[^{}]{1,300}\\})$', description: 'idioma das mensagens (padrão: o do visitante)' } }, required: ['formulario'] }, eventos: { aoEnviado: { payload: 'json' }, aoErro: { payload: 'json' } } }),
  bloco('nav/botao', { props: { type: 'object', properties: { texto: { type: 'string' }, desabilitado: { type: 'boolean' }, atual: { type: 'boolean', description: 'o item escolhido (aria-current), ex.: no menu lateral' }, icone: ICONE_PROP, iconeApos: ICONE_APOS, rotulo: ROTULO, expandido: { type: 'boolean', description: 'botão que abre/fecha algo: leva aria-expanded (verdadeiro/falso)' }, arrasta: { type: 'string', maxLength: 120, description: 'torna o botão arrastável (`draggable`) e leva este valor ao soltar numa `midia/tela` (evento `aoSoltar`); letras, números, _ e -' }, alvo: { type: 'string', maxLength: 120, description: 'identifica o que o botão representa (data-alvo; letras, números, _ e -): o hospedeiro usa para realçar o item correspondente' }, variante: { type: 'string', enum: ['primario', 'secundario', 'fantasma'], description: 'primario (padrão): cheio na cor primária; secundario: contorno; fantasma: só o texto' } }, required: ['texto'] }, eventos: { aoClicar: {} } }),
  bloco('entrada/texto', { props: { type: 'object', properties: { valor: { type: 'string' }, rotulo: ROTULO, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' }, lista: { type: 'string', description: 'id de um `form/sugestoes` da página: o navegador oferece as opções ao digitar (a lista de valores disponíveis)' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('layout/grade', { slots: { filhos: {} }, props: { type: 'object', properties: { marca: { type: 'string', description: 'gancho de estilo (`data-marca`) que o tema usa, ex.: `indicadores`' }, colunas: { type: 'integer', minimum: 1, maximum: 12, default: 2 }, gap: { type: 'number', minimum: 0 }, alinha: { enum: ['inicio', 'centro', 'fim', 'esticar'], description: 'alinhamento vertical das células (padrão: esticar)' } } } }),
  bloco('layout/contido', { slots: { filhos: {} }, props: { type: 'object', properties: { largura: { enum: ['estreita', 'normal', 'larga'], default: 'normal', description: 'a largura máxima do conteúdo (centrado, com margens): estreita, normal ou larga; os valores vêm do tema (`layout.largura*`)' } } } }),
  bloco('layout/cabecalho', { slots: { filhos: {} }, props: { type: 'object', properties: { fixo: { type: 'boolean', default: false }, centro: { type: 'boolean', default: false, description: 'o menu fica centralizado entre a marca e as ações' } } } }),
  bloco('layout/painel', { slots: { filhos: {} } }),
  bloco('layout/lateral', { slots: { filhos: {} }, props: { type: 'object', properties: { rotulo: ROTULO } } }),
  bloco('layout/principal', { slots: { filhos: {} } }),
  bloco('layout/cartao', { slots: { filhos: {} }, props: { type: 'object', properties: { papel: { enum: ['toolbar', 'group', 'list', 'status'] }, rotulo: { type: 'string', maxLength: 200 } } } }),
  bloco('midia/tela', { slots: { filhos: {} }, props: { type: 'object', properties: {
    proporcao: { type: 'number', exclusiveMinimum: 0.05, maximum: 20, description: 'largura ÷ altura da moldura (a prévia de uma peça A4 em pé é 0,7071)' },
    caixas: { type: 'array', maxItems: 200, description: 'as caixas desenhadas por cima dos filhos, que o usuário arrasta e redimensiona (frações da moldura)', items: { type: 'object', properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }, rotulo: { type: 'string', maxLength: 120 }, topo: { type: 'number' }, esquerda: { type: 'number' }, largura: { type: 'number' }, altura: { type: 'number' }, rotacao: { type: 'number' }, atual: { type: 'boolean' } } } },
    passo: { type: 'number', minimum: 0.001, maximum: 0.1, default: 0.005, description: 'a grade de encaixe do arrastar (fração da moldura)' },
  } }, eventos: { aoMover: { payload: 'json' }, aoSelecionar: { payload: 'json' }, aoSoltar: { payload: 'json' } } }),
  bloco('layout/secao', { slots: { filhos: {} }, props: { type: 'object', properties: { aberta: { type: 'boolean', description: 'começa aberta (o leitor pode recolher)' } } } }),
  bloco('layout/secao-titulo', { props: { type: 'object', properties: { texto: { type: 'string', maxLength: 120 }, icone: ICONE_PROP } } }),
  bloco('nav/submenu', { slots: { filhos: {} } }),
  bloco('nav/submenu-titulo', { props: { type: 'object', properties: { texto: { type: 'string', maxLength: 80 } } } }),
  bloco('nav/menu', { slots: { filhos: {} }, props: { type: 'object', properties: { rotulo: { type: 'string', maxLength: 80 }, marca: MARCA } } }),
  bloco('entrada/selecao', { slots: { filhos: {} }, props: { type: 'object', properties: { valor: { type: 'string' }, rotulo: ROTULO, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'texto' } } }),
  bloco('entrada/opcao', { props: { type: 'object', properties: { valor: { type: 'string' }, texto: { type: 'string' }, selecionada: { type: 'boolean', description: 'a opção escolhida (marque a que combina com `valor` do seletor)' } }, required: ['valor', 'texto'] } }),
  bloco('nav/alternador', { props: { type: 'object', properties: { rotulo: ROTULO } } }),
  bloco('form/busca', { slots: { filhos: {} }, props: { type: 'object', properties: { acao: { type: 'string', maxLength: 300, description: 'caminho do PRÓPRIO site que recebe a busca (padrão /busca); outro valor vale o padrão' } } } }),
  bloco('entrada/busca', { props: { type: 'object', properties: { nome: { type: 'string', maxLength: 31, description: 'nome do parâmetro na URL (padrão q)' }, rotulo: ROTULO, placeholder: { type: 'string', maxLength: 100 }, valor: { type: 'string', maxLength: 200, description: 'texto inicial (ex.: o termo buscado, `{consulta.q}`)' }, lista: { type: 'string', maxLength: 64, description: 'id de um `form/sugestoes` da página: o navegador oferece as opções enquanto se digita' } } } }),
  bloco('form/sugestoes-ao-vivo', { props: { type: 'object', properties: { url: { type: 'string', maxLength: 300, description: 'caminho do PRÓPRIO site que lista (JSON) as sugestões, ex.: /api/loja/destaques; o cliente acrescenta `busca=<termo>&limite=<n>`' }, titulo: { type: 'string', maxLength: 41, description: 'campo do JSON com o título (padrão titulo)' }, descricao: { type: 'string', maxLength: 41 }, imagem: { type: 'string', maxLength: 41, description: 'campo com o caminho da miniatura (só caminhos do próprio site)' }, limite: { type: 'integer', minimum: 1, maximum: 10, description: 'quantas sugestões (padrão 6)' }, destino: { type: 'string', maxLength: 300, description: 'página da escolha (padrão /busca): abre `destino?q=<título>`' }, nome: { type: 'string', maxLength: 31, description: 'parâmetro do destino (padrão q)' }, rotulo: { type: 'string', maxLength: 100 } }, required: ['url'] } }),
  bloco('form/sugestoes', { slots: { filhos: {} } }),
  bloco('form/opcao', { props: { type: 'object', properties: { valor: { type: 'string', maxLength: 100 } } } }),
  bloco('nav/enviar', { props: { type: 'object', properties: { texto: { type: 'string', maxLength: 60, default: 'Enviar' } } } }),
  bloco('entrada/arquivo', { props: { type: 'object', properties: { rotulo: ROTULO, aceita: { type: 'string', maxLength: 200, description: 'tipos aceitos pelo seletor (atributo accept), ex.: image/png,image/jpeg' }, tamanhoMax: { type: 'integer', minimum: 1024, maximum: 8388608, default: 2097152, description: 'bytes; acima disso o evento traz `erro` e o arquivo nem é lido' }, desabilitado: { type: 'boolean' } } }, eventos: { aoEscolher: { payload: 'json' }, aoRecusar: { payload: 'json' } } }),
  bloco('layout/destaque', { slots: { filhos: {} }, props: { type: 'object', properties: { imagem: { type: 'string', maxLength: 500, description: 'URL segura (mesma origem: o CSP das páginas só carrega imagens do próprio site)' }, altura: { type: 'number', minimum: 120, maximum: 800, default: 320, description: 'altura mínima em px' }, ocupa: { type: 'integer', minimum: 1, maximum: 12, description: 'quantas colunas ocupa quando está numa `layout/grade` (grid-column: span N)' }, proporcao: { type: 'number', minimum: 0.2, maximum: 5, description: 'largura ÷ altura da faixa (16/9 = 1,778; 3/4 = 0,75): no lugar da altura mínima' }, zoom: { type: 'boolean', description: 'a foto de fundo cresce e escurece no hover (tokens movimento.zoomFaixa e movimento.zoomFaixaDuracao)' }, capa: { type: 'boolean', description: 'faixa de capa (hero): o texto fica embaixo, a faixa sobe por baixo do cabeçalho; com `altura` 800 ocupa a tela toda (100svh), senão no máximo a tela (token cabecalho.altura), a foto faz um zoom lento e o texto entra (tokens movimento.*)' }, escurece: { type: 'number', minimum: 0, maximum: 0.8, default: 0.45, description: 'véu escuro sobre a imagem, para o texto ler' }, alinha: { type: 'string', description: 'centro (padrão) ou esquerda (outro valor vale centro)' }, fundo: { type: 'string', description: 'sem imagem: primaria (padrão) ou suave (outro valor vale primaria)' } } } }),
  bloco('layout/rodape', { slots: { filhos: {} } }),
  bloco('layout/gaveta', { slots: { filhos: {} }, eventos: { aoFechar: {} }, props: { type: 'object', properties: { aberta: { type: 'boolean', description: 'com ela o painel fica sempre montado e o CSS anima a entrada e a saída (ligue a um estado); sem ela, mostre-o com `se`' }, rotulo: { type: 'string', description: 'nome acessível do diálogo (padrão: Detalhes)' }, lado: { enum: ['direita', 'esquerda'], default: 'direita' }, largura: { type: 'number', minimum: 12, maximum: 80, description: 'largura em rem (padrão 30)' } } } }),
  bloco('layout/modal', { slots: { filhos: {} }, eventos: { aoFechar: {} }, props: { type: 'object', properties: { aberta: { type: 'boolean', description: 'com ela o painel fica sempre montado e o CSS anima a entrada e a saída (ligue a um estado); sem ela, mostre-o com `se`' }, rotulo: { type: 'string', description: 'nome acessível do diálogo (padrão: Diálogo)' }, largura: { type: 'number', minimum: 12, maximum: 80, description: 'largura em rem (padrão 36)' } } } }),
  bloco('layout/divisor'),
  bloco('grafico/svg', { slots: { filhos: {} }, props: { type: 'object', properties: { largura: { type: 'number', minimum: 1, default: 100, description: 'largura do sistema de coordenadas (viewBox); o desenho escala para a largura do contêiner' }, altura: { type: 'number', minimum: 1, default: 100 }, rotulo: { type: 'string', description: 'descrição para leitor de tela; sem ela o gráfico é decorativo (aria-hidden)' }, marca: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' } } } }),
  bloco('grafico/circulo', { eventos: { aoClicar: {} }, props: { type: 'object', properties: { cx: NUM, cy: NUM, r: { type: 'number', minimum: 0, default: 4 }, cor: COR, tom: TOM, rotulo: { type: 'string', description: 'com rótulo o círculo vira um botão acessível (`aoClicar`)' }, selecionado: { type: 'boolean' } } } }),
  bloco('grafico/retangulo', { eventos: { aoClicar: {} }, props: { type: 'object', properties: { x: NUM, y: NUM, largura: { type: 'number', minimum: 0 }, altura: { type: 'number', minimum: 0 }, raio: { type: 'number', minimum: 0 }, cor: COR, tom: TOM, rotulo: { type: 'string' }, selecionado: { type: 'boolean' } } } }),
  bloco('grafico/reta', { props: { type: 'object', properties: { x1: NUM, y1: NUM, x2: NUM, y2: NUM, cor: COR, tom: TOM, espessura: { type: 'number', minimum: 0, default: 1 }, tracejada: { type: 'boolean' } } } }),
  bloco('grafico/caminho', { props: { type: 'object', properties: { pontos: { type: 'array', items: { type: 'array', items: NUM, minItems: 2, maxItems: 2 }, maxItems: 2000, description: 'lista de [x, y] ligados por retas' }, d: { type: 'string', maxLength: 4000, description: 'ou o texto `d` do SVG (M L H V C Z…)' }, cor: COR, tom: TOM, preenche: COR, espessura: { type: 'number', minimum: 0, default: 1 } } } }),
  bloco('grafico/rotulo', { props: { type: 'object', properties: { x: NUM, y: NUM, texto: { type: ['string', 'number'] }, ancora: { enum: ['inicio', 'centro', 'fim'] }, base: { enum: ['auto', 'central'] }, fonte: { enum: ['corpo', 'titulo', 'mono'], description: 'a família do texto: a do corpo, a dos títulos (`tipografia.familiaTitulo`) ou a monoespaçada (`tipografia.familiaMono`)' }, tamanho: { type: 'number', minimum: 1 }, espacamento: { type: 'number', description: 'espaçamento entre letras, em em (ex.: 0.16)' }, caixa: { enum: ['normal', 'maiuscula'] }, cor: COR, tom: TOM } } }),
  bloco('layout/espacador', { props: { type: 'object', properties: { tamanho: { type: 'number', minimum: 0, default: 8 } } } }),
  bloco('texto/rotulo', { props: { type: 'object', properties: { texto: { type: 'string' }, para: { type: 'string' } }, required: ['texto'] } }),
  bloco('texto/destaque', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('texto/sobretitulo', { props: { type: 'object', properties: { texto: { type: 'string', maxLength: 200 }, tom: { type: 'string', description: 'cor do texto pelo nome do tom do tema (token `grafico.<tom>`)' }, escala: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,23}$', description: 'escala tipográfica nomeada: lê os tokens do tema `tipografia.escala.<nome>.tamanho|peso|altura|espacamento` (cada um cai no padrão do bloco quando falta)' } }, required: ['texto'] } }),
  bloco('texto/pequeno', { props: { type: 'object', properties: { texto: { type: 'string' }, tom: { type: 'string', description: 'cor do texto pelo nome do tom do tema (token `grafico.<tom>`)' } }, required: ['texto'] } }),
  bloco('texto/codigo', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }),
  bloco('lista/lista', { slots: { filhos: { aceita: ['lista/item'] } }, props: { type: 'object', properties: { ordenada: { type: 'boolean', default: false } } } }),
  bloco('lista/item', { slots: { filhos: {} } }),
  bloco('tabela/tabela', { slots: { filhos: { aceita: ['tabela/cabecalho', 'tabela/corpo'] } } }),
  bloco('tabela/cabecalho', { slots: { filhos: { aceita: ['tabela/linha'] } } }),
  bloco('tabela/corpo', { slots: { filhos: { aceita: ['tabela/linha'] } } }),
  bloco('tabela/linha', { slots: { filhos: { aceita: ['tabela/celula'] } }, eventos: { aoClicar: {} }, props: { type: 'object', properties: { clicavel: { type: 'boolean', description: 'a linha inteira é clicável (cursor de mão e realce); ligue `aoClicar`' } } } }),
  bloco('tabela/celula', { slots: { filhos: {} }, props: { type: 'object', properties: { texto: { type: 'string' }, tom: { type: 'string', description: 'cor do texto pelo nome do tom do tema (token `grafico.<tom>`)' }, cabecalho: { type: 'boolean', default: false }, colunas: { type: 'integer', minimum: 1, maximum: 1000 }, linhas: { type: 'integer', minimum: 1, maximum: 65534 } } } }),
  bloco('entrada/numero', { props: { type: 'object', properties: { valor: { type: ['number', 'string'] }, rotulo: ROTULO, min: { type: 'number' }, max: { type: 'number' }, passo: { type: 'number' }, placeholder: { type: 'string' }, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'decimal' } } }),
  bloco('entrada/caixa', { props: { type: 'object', properties: { marcado: { type: 'boolean' }, rotulo: ROTULO, desabilitado: { type: 'boolean' } } }, eventos: { aoMudar: { payload: 'booleano' } } }),
  bloco('feedback/selo', { props: { type: 'object', properties: { texto: { type: 'string' }, tom: { enum: ['neutro', 'sucesso', 'alerta', 'erro'], default: 'neutro' } }, required: ['texto'] } }),
  bloco('feedback/alerta', { slots: { filhos: {} }, props: { type: 'object', properties: { tom: { enum: ['neutro', 'sucesso', 'alerta', 'erro'], default: 'neutro' } } } }),
  bloco('midia/icone', { props: { type: 'object', properties: { nome: { type: 'string', enum: NOMES_ICONES, description: 'o ícone (60 na família Grafite: `layout-pilha`, `salvar`, `publicar`…)' }, tamanho: { type: 'number', minimum: 8, maximum: 96, description: 'lado em px (padrão 1,25 em, acompanha o texto)' }, rotulo: { type: 'string', maxLength: 200, description: 'nome acessível; sem ele o ícone é decorativo (aria-hidden)' }, acento: { type: 'boolean', description: 'o detalhe de acento na cor de destaque do tema' } }, required: ['nome'] } }),
  bloco('nav/link', { slots: { filhos: {} }, props: { type: 'object', properties: { href: { type: 'string' }, texto: { type: 'string' }, botao: { type: 'string', maxLength: 12, description: 'primario, secundario ou texto: o link com aparência de botão (texto: caixa alta pequena, com seta se houver `icone`)' }, atual: { type: 'boolean', description: 'a página atual: o link leva aria-current="page"' }, rotulo: ROTULO, iconeApos: ICONE_APOS, soConsulta: { type: 'boolean', description: 'o link só muda a consulta da URL (?nome=valor) da MESMA página: o estado ligado a ela (`daConsulta`) muda e a URL acompanha, sem recarregar nem voltar ao topo' }, icone: ICONE_PROP }, required: ['href'] } }),
]

/** Registra no Registry o core/slot e os blocos base. */
export function registraBase(reg: Registry): void {
  registraNativos(reg)
  for (const b of BLOCOS_BASE) reg.registra(structuredClone(b))
}
