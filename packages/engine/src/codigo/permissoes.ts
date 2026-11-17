// Permissões do código em iframe → atributo sandbox e CSP. Tudo é "negado por padrão": só o que foi
// declarado E está na allowlist da plataforma é liberado.

export type Permissoes = { formularios: boolean; rede: string[]; imagens: string[] }
export type ResultadoPermissoes = { ok: true; permissoes: Permissoes } | { ok: false; erros: string[] }

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const INTERNOS = ['local', 'localhost', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain']

/** Host público plausível: nome de domínio com TLD alfabético; recusa IP, localhost e sufixos internos. */
export function hostPublicoValido(host: string): string | null {
  if (host.length > 253) return 'host longo demais'
  const labels = host.split('.')
  if (labels.length < 2) return 'precisa de um domínio com ponto (sem nomes locais como "localhost")'
  if (!labels.every((l) => LABEL.test(l))) return 'host com caracteres inválidos'
  const tld = labels[labels.length - 1]!
  if (!/^[a-z]{2,}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return 'o domínio de topo precisa ser alfabético (IP não é permitido)'
  if (INTERNOS.includes(tld)) return `o sufixo .${tld} é de rede interna`
  return null
}

/** Normaliza `https://host[:porta]` (minúsculas). Devolve null + motivo se inválida. */
export function normalizaOrigem(origem: string): { ok: true; origem: string } | { ok: false; motivo: string } {
  const m = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(origem)
  if (!m) return { ok: false, motivo: 'use https://dominio[:porta], sem caminho, curinga ou credenciais' }
  const motivo = hostPublicoValido(m[1]!.toLowerCase())
  if (motivo) return { ok: false, motivo }
  if (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return { ok: false, motivo: 'porta fora de 1–65535' }
  return { ok: true, origem: `https://${m[1]!.toLowerCase()}${m[2] ? ':' + Number(m[2]) : ''}` }
}

export function parsePermissoes(lista: readonly string[] = []): ResultadoPermissoes {
  const erros: string[] = []
  const p: Permissoes = { formularios: false, rede: [], imagens: [] }
  for (const item of lista) {
    if (item === 'formularios') { p.formularios = true; continue }
    const m = /^(rede|imagens):(.*)$/.exec(item)
    if (!m) { erros.push(`permissão desconhecida: '${item}'`); continue }
    const o = normalizaOrigem(m[2]!)
    if (!o.ok) { erros.push(`'${item}': ${o.motivo}`); continue }
    const alvo = m[1] === 'rede' ? p.rede : p.imagens
    if (!alvo.includes(o.origem)) alvo.push(o.origem)
  }
  return erros.length ? { ok: false, erros } : { ok: true, permissoes: p }
}

/** Origens pedidas que a plataforma NÃO liberou (allowlist exata). */
export function foraDaAllowlist(p: Permissoes, allowlist: readonly string[] = []): string[] {
  const ok = new Set(allowlist.map((o) => { const n = normalizaOrigem(o); return n.ok ? n.origem : '' }))
  return [...new Set([...p.rede, ...p.imagens])].filter((o) => !ok.has(o))
}

/** Valor do atributo `sandbox`. Nunca inclui allow-same-origin, allow-top-navigation, allow-popups, allow-modals, allow-downloads. */
export function atributoSandbox(linguagem: 'js' | 'html', p: Permissoes): string {
  const flags: string[] = []
  if (linguagem === 'js') flags.push('allow-scripts')
  if (p.formularios) flags.push('allow-forms')
  return flags.join(' ')
}

/** CSP do documento do iframe. `hashScript` = base64 do SHA-256 do script inline (modo js); modo html não executa script nenhum. */
export function construirCsp(linguagem: 'js' | 'html', p: Permissoes, hashScript?: string): string {
  const rede = p.rede.length ? p.rede.join(' ') : "'none'"
  const script = linguagem === 'js' && hashScript ? `'sha256-${hashScript}'` : "'none'"
  return [
    "default-src 'none'",
    `script-src ${script}`,
    "style-src 'unsafe-inline'",
    `img-src data: ${p.imagens.join(' ')}`.trim(),
    'font-src data:',
    `connect-src ${rede}`,
    `form-action ${p.formularios ? rede : "'none'"}`,
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
  ].join('; ')
}
