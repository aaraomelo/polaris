// Converte as configurações do easysync-banner-app em nós `cartaz` (um arquivo JSON por cliente) e imprime o relatório.
//   pnpm --filter @polaris/studio-app exec tsx ../../packages/signmaker/scripts/converte-legado.ts <repo-legado> <pasta-de-saida> [cliente ...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { converteConfiguracao } from '../src'

const [legado, saida, ...clientes] = process.argv.slice(2)
if (!legado || !saida) { console.error('uso: converte-legado.ts <repo-legado> <pasta-de-saida> [cliente ...]'); process.exit(2) }
const base = join(legado, 'src/store/banner/configurations')
mkdirSync(saida, { recursive: true })
for (const cliente of clientes.length ? clientes : ['curio', 'goiana', 'saojorge']) {
  const cfg = Object.fromEntries(['globals', 'modifiers', 'complements', 'geometries'].map((k) => [k, JSON.parse(readFileSync(join(base, cliente, `${k}.json`), 'utf8'))]))
  const { nos, relatorio } = converteConfiguracao(cfg, cliente)
  writeFileSync(join(saida, `${cliente}.json`), `${JSON.stringify(nos.map((c) => c.no), null, 2)}\n`)
  console.log(`${cliente}: ${nos.length} layout(s) em ${join(saida, `${cliente}.json`)}`)
  for (const a of relatorio.avisos) console.log(`  aviso: ${a}`)
  for (const a of relatorio.naoConvertidos) console.log(`  não convertido: ${a}`)
}
