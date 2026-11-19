// URL segura para href/src. Módulo puro (sem React): o caminho estático também o usa.

const SCHEMES_OK = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * URL segura para href/src: relativa ou com esquema permitido. Bloqueia javascript:, data:, vbscript: etc.
 *
 * ATENÇÃO ao que se devolve: o parser de URL do navegador só descarta, nas pontas, controles C0 e espaço (U+0000–U+0020).
 * O `trim()` do JavaScript remove MAIS (NBSP, U+2028, BOM, espaços Unicode): "\u00a0javascript:x" é uma URL relativa
 * inofensiva para o navegador, mas depois de `trim()` vira "javascript:x", executável. Por isso só se apara o que o
 * navegador apara.
 */
export function urlSegura(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // navegadores ignoram espaços e controles dentro do esquema ("java\nscript:"): para DETECTAR o esquema, removemos todos (conservador)
  const limpa = v.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  if (!limpa) return undefined
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec(limpa)
  if (m && !SCHEMES_OK.has(m[1]!.toLowerCase())) return undefined
  return v.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '') // exatamente o que o navegador apara
}

/** uma URL já considerada segura, escrita como `url("…")` de CSS: aspas, parênteses e contrabarra viram escapes de URL (nada fecha o `url(` nem a declaração) */
export const cssUrl = (u: string): string => `url("${encodeURI(u).replace(/["'()\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}")`

/** destino do envio de um formulário de busca: só um CAMINHO do próprio site (começa com uma barra, sem `//`, sem barra invertida nem controles); qualquer outra coisa vale o padrão. O CSP das páginas (`form-action 'self'`) é a segunda barreira. */
export const caminhoLocal = (v: unknown, padrao = '/busca'): string => (typeof v === 'string' && /^\/(?!\/)[^\\\u0000-\u001f\u007f\s]{0,300}$/.test(v) ? v : padrao)
/** nome do parâmetro da busca: identificador simples; senão `q` */
export const nomeDeParametro = (v: unknown, padrao = 'q'): string => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(v) ? v : padrao)

/** larguras das versões menores que o envio gera (`packages/packs/src/ativos.ts`, `LARGURAS_VARIANTES`) */
export const LARGURAS_SRCSET = [160, 480, 960, 1920] as const
const IMAGEM_DO_TENANT = /^\/_polaris\/img\/([0-9a-f]{64})\.(?:png|jpg|webp)$/
/** `srcset` automático para uma imagem hospedada pela plataforma (`/_polaris/img/<hash>.png|jpg|webp`): as versões webp de 160/480/960/1920 px; undefined para qualquer outra URL (e para gif, que pode ser animado). O servidor devolve o original quando a versão não existe (imagem menor que a largura). */
export const srcsetDe = (src: string | undefined): string | undefined => { const m = src ? IMAGEM_DO_TENANT.exec(src) : null; return m ? LARGURAS_SRCSET.map((w) => `/_polaris/img/${m[1]}.webp?w=${w} ${w}w`).join(', ') : undefined }
/** `sizes`: o que a página declarou (só caracteres de expressão de mídia) ou, com `largura`, "até N px"; sem nada, undefined (e então o bloco NÃO emite srcset: assumir 100vw mudaria o tamanho natural da imagem) */
export const tamanhosDe = (declarado: unknown, largura: number | undefined): string | undefined =>
  typeof declarado === 'string' && /^[A-Za-z0-9\s().,%:+*/-]{1,200}$/.test(declarado) ? declarado : largura !== undefined ? `(max-width: ${largura}px) 100vw, ${largura}px` : undefined

/** id de um elemento da própria página (para `list`, `for`…): letra e até 64 caracteres seguros; senão undefined */
export const idDeElemento = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v) ? v : undefined)
