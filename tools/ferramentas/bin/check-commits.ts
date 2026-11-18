import { execFileSync } from 'node:child_process'
import { validaMensagem } from '../src/commits.ts'

// uso: check-commits.ts <intervalo git, ex.: origin/main..HEAD>   (CI: todo commit do PR)
const intervalo = process.argv[2]
if (!intervalo || !/^[A-Za-z0-9._/~^-]+\.\.[A-Za-z0-9._/~^-]+$/.test(intervalo)) { console.error('uso: check-commits.ts <base>..<head>'); process.exit(2) }
const shas = execFileSync('git', ['rev-list', '--no-merges', intervalo], { encoding: 'utf8' }).split('\n').filter(Boolean)
let falhas = 0
for (const sha of shas) {
  const msg = execFileSync('git', ['log', '-1', '--format=%B', sha], { encoding: 'utf8' }).trim()
  const r = validaMensagem(msg)
  if (!r.ok) { falhas++; console.error(`✗ ${sha.slice(0, 10)} ${JSON.stringify(msg.split('\n')[0]?.slice(0, 70))}\n${r.motivos.map((m) => `    - ${m}`).join('\n')}`) }
}
console.log(falhas ? `${falhas} de ${shas.length} commit(s) fora do padrão` : `ok: ${shas.length} commit(s) no padrão`)
process.exit(falhas ? 1 : 0)
