import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { geraDocFuncoes } from '../src/expr/docs'

const destino = join(__dirname, '..', '..', '..', 'docs', 'funcoes.md')
writeFileSync(destino, geraDocFuncoes())
console.log(`escrito: ${destino}`)
