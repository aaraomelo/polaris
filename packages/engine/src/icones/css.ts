import { ICONES } from './dados'

// CSS dos ícones: cada um vira duas variáveis com uma imagem SVG (data URI) usada como MÁSCARA, então a cor vem de `currentColor` (e do acento, se pedido). Nenhuma cor literal: a máscara só usa o canal alfa.
const svg = (corpo: string): string => {
  const s = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${corpo.replace(/"/g, "'")}</svg>`
  return `url("data:image/svg+xml,${s.replace(/%/g, '%25').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`
}
const vazio = svg('')

/** as regras de estrutura (tamanho, camadas) e uma por ícone (as duas imagens) */
export const ICONES_CSS = [
  '#polaris span[data-icone]{display:inline-block;flex:none;position:relative;width:var(--icone-tamanho,1.25em);height:var(--icone-tamanho,1.25em);vertical-align:middle}',
  '#polaris span[data-icone]::before,#polaris span[data-icone]::after{content:"";position:absolute;inset:0;background:currentColor;-webkit-mask:var(--ic-base) center/contain no-repeat;mask:var(--ic-base) center/contain no-repeat}',
  '#polaris span[data-icone]::after{background:var(--icone-acento,currentColor);-webkit-mask-image:var(--ic-acento);mask-image:var(--ic-acento)}',
  '#polaris span[data-icone][data-acento]{--icone-acento:var(--cor-destaque)}',
  '#polaris :is(button,a,summary)[data-icone]{display:inline-flex;align-items:center;gap:calc(var(--espacamento-base) * 1)}',
  '#polaris :is(button,a,summary)[data-icone]::before{content:"";flex:none;width:var(--icone-tamanho,1.25em);height:var(--icone-tamanho,1.25em);background:currentColor;-webkit-mask:var(--ic-base) center/contain no-repeat,var(--ic-acento) center/contain no-repeat;mask:var(--ic-base) center/contain no-repeat,var(--ic-acento) center/contain no-repeat}',
  '#polaris :is(button,a,summary)[data-icone][data-icone-apos]::before{content:none}',
  '#polaris :is(button,a,summary)[data-icone][data-icone-apos]::after{content:"";flex:none;width:var(--icone-tamanho,1.25em);height:var(--icone-tamanho,1.25em);background:currentColor;-webkit-mask:var(--ic-base) center/contain no-repeat,var(--ic-acento) center/contain no-repeat;mask:var(--ic-base) center/contain no-repeat,var(--ic-acento) center/contain no-repeat;transition:transform var(--movimento-rapido,0s) ease}',
  '#polaris :is(button,a)[data-icone][data-icone-apos]:hover::after{transform:translateX(var(--icone-desloca,0))}',
  ...Object.entries(ICONES).map(([nome, i]) => `#polaris [data-icone=${nome}]{--ic-base:${svg(i.base)};--ic-acento:${i.acento ? svg(i.acento) : vazio}}`),
].join('\n')
