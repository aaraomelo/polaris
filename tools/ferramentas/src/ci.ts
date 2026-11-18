import { parse } from 'yaml'

// Confere o workflow de CI contra o que costuma dar errado de verdade: ação por tag (pode ser reescrita), permissões amplas, injeção de script por dado do evento,
// segredo exposto a código de PR de fork, job sem prazo, comando que não existe. Roda no próprio CI e como teste: o CI não se aprova sozinho.

type Passo = { uses?: string; run?: string; name?: string; with?: Record<string, unknown>; env?: Record<string, unknown> }
type Job = { 'runs-on'?: unknown; 'timeout-minutes'?: number; steps?: Passo[]; permissions?: unknown; if?: string; needs?: unknown }
type Workflow = { name?: string; on?: unknown; permissions?: unknown; jobs?: Record<string, Job>; concurrency?: unknown; env?: Record<string, unknown> }

const SHA = /^[0-9a-f]{40}$/
const INJECAO = /\$\{\{\s*(github\.(event\.|head_ref|ref_name)|inputs\.|env\.[A-Za-z_]*(TITLE|BODY|BRANCH)|steps\.[^}]*outputs)/i

export function validaWorkflow(yaml: string, scriptsDoPackage: string[]): string[] {
  const erros: string[] = []
  let w: Workflow
  try { w = parse(yaml) as Workflow } catch (e) { return [`YAML inválido: ${(e as Error).message}`] }
  const gatilhos = JSON.stringify(w.on ?? {})
  if (/pull_request_target|workflow_run/.test(gatilhos)) erros.push('gatilho pull_request_target/workflow_run roda código do PR com permissões do repositório: não use')
  const p = w.permissions as Record<string, string> | string | undefined
  if (p === undefined) erros.push('falta `permissions:` no topo (o padrão do GitHub é amplo); declare o mínimo (contents: read)')
  else if (typeof p === 'string' || Object.values(p).some((v) => v === 'write')) erros.push('`permissions` de topo deve ser somente leitura')
  if (!w.concurrency) erros.push('falta `concurrency:` (runs antigos do mesmo PR devem ser cancelados)')
  if (/\$\{\{\s*secrets\./.test(yaml)) erros.push('o CI não deve precisar de `secrets.*`: testes rodam sem credencial (Postgres é PGlite em memória)')
  for (const [id, job] of Object.entries(w.jobs ?? {})) {
    if (!job['timeout-minutes']) erros.push(`job '${id}': falta timeout-minutes (um job travado consome minutos até o limite de 6 h)`)
    for (const [i, s] of (job.steps ?? []).entries()) {
      const onde = `job '${id}', passo ${i + 1}${s.name ? ` (${s.name})` : ''}`
      if (s.uses) {
        const [acao, ref] = s.uses.split('@')
        if (acao?.startsWith('./')) continue
        if (!ref || !SHA.test(ref)) erros.push(`${onde}: '${s.uses}' não está fixada por SHA de commit de 40 caracteres (tag/branch podem ser reescritas: risco de cadeia de suprimento)`)
        if (acao === 'actions/checkout' && (s.with as Record<string, unknown> | undefined)?.['persist-credentials'] !== false) erros.push(`${onde}: actions/checkout sem persist-credentials: false deixa o token no .git para os passos seguintes`)
      }
      if (s.run) {
        if (INJECAO.test(s.run)) erros.push(`${onde}: \`run\` interpola dado do evento (\${{ github.event… }}): injeção de script. Passe por \`env:\` e use "$VAR"`)
        for (const m of s.run.matchAll(/\bpnpm (?:run )?([a-z0-9:-]+)/g)) {
          const cmd = m[1]!
          if (['install', 'i', 'add', 'audit', 'exec', 'dlx', 'store', 'turbo', 'run', 'config', 'fetch', '-r', 'ci'].includes(cmd) && cmd !== 'ci') continue
          if (!scriptsDoPackage.includes(cmd)) erros.push(`${onde}: 'pnpm ${cmd}' não existe nos scripts do package.json`)
        }
        if (/curl[^|\n]*\|\s*(ba)?sh/.test(s.run)) erros.push(`${onde}: baixa e executa script remoto (curl | sh)`)
      }
    }
  }
  return erros
}
