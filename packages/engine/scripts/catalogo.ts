// Catálogo de blocos (docs vivas): registry → HTML claro/escuro + Markdown.   pnpm catalogo --saida <dir> [--nos <dir com nós *.json>] [--tema <id>]
import { Registry } from '@polaris/schema'
import { nosDoDiretorio } from '../src/aot/index'
import { escreveCatalogo } from '../src/catalogo/escreve'
import { registraBase } from '../src/index'
import { registraCommerce } from '../src/commerce/index'
import { registraTemas, TEMA_PADRAO } from '../src/tema/index'

const args = process.argv.slice(2)
const valor = (nome: string): string | undefined => { const i = args.indexOf(`--${nome}`); return i >= 0 ? args[i + 1] : undefined }
const saida = valor('saida')
if (!saida) { console.error('uso: pnpm catalogo --saida <diretório> [--nos <diretório com os nós *.json>] [--tema <id>]'); process.exit(2) }

const reg = new Registry(); registraBase(reg); registraTemas(reg); registraCommerce(reg)
const nos = valor('nos')
if (nos) for (const n of nosDoDiretorio(nos)) { try { reg.registra(n) } catch (e) { console.error(`✗ nó inválido: ${(e as Error).message}`) } }
const tema = reg.resolve('tema', valor('tema') ?? 'padrao', {})?.no ?? TEMA_PADRAO
const r = escreveCatalogo(reg, saida, { tema })
console.log(`${r.blocos} blocos, ${r.exemplos} exemplos → ${saida} (${r.arquivos.join(', ')})`)
for (const e of r.erros) console.error(`✗ ${e}`)
process.exit(r.erros.length ? 1 : 0)
