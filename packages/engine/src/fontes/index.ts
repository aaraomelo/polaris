// Fontes EMBUTIDAS na plataforma (lista fixa, sem upload de tenant): o tema as pede por nome em `spec.fontes` e o servidor as serve da própria origem
// (a CSP já tem `font-src 'self'`). Só o gateway importa este módulo (`@polaris/engine/fontes`): os ~170 KB em base64 nunca entram num bundle de cliente.
import { DADOS_FONTES } from './dados'

type Arquivo = { estilo: 'normal' | 'italic'; peso: string; dados: keyof typeof DADOS_FONTES }
export type FonteEmbutida = { familia: string; arquivos: Arquivo[] }

export const FONTES_EMBUTIDAS: Record<string, FonteEmbutida> = {
  'cormorant-garamond': { familia: 'Cormorant Garamond', arquivos: [{ estilo: 'normal', peso: '300 700', dados: 'cormorantNormal' }, { estilo: 'italic', peso: '300 700', dados: 'cormorantItalico' }] },
  inter: { familia: 'Inter', arquivos: [{ estilo: 'normal', peso: '300 700', dados: 'interNormal' }] },
}

/** os bytes de um arquivo da fonte (woff2) */
export const bytesDaFonte = (dados: keyof typeof DADOS_FONTES): Buffer => Buffer.from(DADOS_FONTES[dados], 'base64')

/**
 * O `@font-face` de cada fonte pedida pelo tema. `urlDe` devolve o endereço (mesma origem) de cada arquivo: quem serve é quem chama.
 * Nome desconhecido é ignorado (o tema cai na pilha de fontes do sistema). `font-display: swap`: o texto aparece na hora e troca quando a fonte chega.
 */
export function cssFontFace(nomes: readonly string[], urlDe: (arquivo: keyof typeof DADOS_FONTES) => string): string {
  const out: string[] = []
  for (const nome of nomes) {
    const f = FONTES_EMBUTIDAS[nome]; if (!f) continue
    for (const a of f.arquivos) out.push(`@font-face{font-family:'${f.familia}';font-style:${a.estilo};font-weight:${a.peso};font-display:swap;src:url(${urlDe(a.dados)}) format('woff2')}`)
  }
  return out.join('\n')
}
