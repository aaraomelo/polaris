// Regras de commit do projeto (CLAUDE.md): `PL-<id> tipo(escopo): mensagem`, em português, e SEM trailer de ferramenta de IA.
// A mesma função roda no hook `commit-msg` (local) e no CI (todo commit do PR), então a regra não depende de lembrar.

export const TIPOS = ['feat', 'fix', 'perf', 'test', 'docs', 'refactor', 'chore', 'build', 'ci', 'style', 'revert'] as const
const ASSUNTO = new RegExp(`^PL-[0-9a-z]{4,20} (${TIPOS.join('|')})(\\([a-z0-9._/-]+\\))?!?: \\S.*$`)
const TRAILER_PROIBIDO = /^\s*(co-authored-by:.*|generated with .*claude.*|🤖 generated.*)$/im
const LIMITE_ASSUNTO = 100

export type ResultadoMensagem = { ok: true } | { ok: false; motivos: string[] }

export function validaMensagem(mensagem: string): ResultadoMensagem {
  const linhas = mensagem.replace(/\r\n/g, '\n').split('\n')
  const assunto = linhas[0] ?? ''
  const motivos: string[] = []
  if (/^(Merge|Revert) /.test(assunto) || /^(fixup|squash|amend)!/.test(assunto)) return { ok: true } // gerados pelo git (merge) não passam pela regra
  if (!ASSUNTO.test(assunto)) motivos.push(`o assunto deve ser "PL-<id> tipo(escopo): mensagem" com tipo em {${TIPOS.join(', ')}} (recebi: ${JSON.stringify(assunto.slice(0, 80))})`)
  if (assunto.length > LIMITE_ASSUNTO) motivos.push(`o assunto tem ${assunto.length} caracteres (máximo ${LIMITE_ASSUNTO})`)
  if (linhas.length > 1 && (linhas[1] ?? '') !== '') motivos.push('deixe uma linha em branco entre o assunto e o corpo')
  if (TRAILER_PROIBIDO.test(mensagem)) motivos.push('commits não levam trailer de ferramenta (nada de Co-Authored-By nem "Generated with Claude")')
  return motivos.length ? { ok: false, motivos } : { ok: true }
}
