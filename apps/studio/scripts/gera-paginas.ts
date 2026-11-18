import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NOS_DO_STUDIO } from '../paginas/studio'

// Gera os nós JSON do Studio a partir do DSL (`pnpm --filter @polaris/studio-app paginas`). O teste confere que o arquivo commitado é exatamente este.
export const SAIDA = join(import.meta.dirname, '..', '..', '..', 'packages', 'packs', 'nos', 'studio', 'pagina-studio.json')
export const conteudo = () => `${JSON.stringify(NOS_DO_STUDIO, null, 1)}\n`
if (process.argv[1] === import.meta.filename) { writeFileSync(SAIDA, conteudo()); console.log(`escrito: ${SAIDA}`) }
