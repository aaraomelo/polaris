// CLI do AOT: schemas (JSON) → arquivos prontos.   pnpm aot --nos <dir> --saida <dir> [--tenant <id>]... [--segmento <s>]...
import { Registry, formataErros, type Contexto } from '@polaris/schema'
import { construirAot, nosDoDiretorio } from '../src/aot/index'
import { registraBase } from '../src/index'

const args = process.argv.slice(2)
const valor = (nome: string): string[] => args.flatMap((a, i) => (a === `--${nome}` && args[i + 1] ? [args[i + 1]!] : []))
const [nos] = valor('nos'), [saida] = valor('saida')
if (!nos || !saida) { console.error('uso: pnpm aot --nos <diretório com os nós *.json> --saida <diretório> [--tenant <id>]... [--segmento <s>]...'); process.exit(2) }

const reg = new Registry()
registraBase(reg)
let invalidos = 0
for (const n of nosDoDiretorio(nos)) {
  try { reg.registra(n) } catch (e) { invalidos++; console.error(`✗ nó inválido: ${(e as Error).message}`) }
}
const contextos: Contexto[] = [{}, ...valor('tenant').map((tenantId) => ({ tenantId })), ...valor('segmento').map((segmento) => ({ segmento }))]
const resultados = await construirAot(reg, { destino: saida, contextos })
let falhou = invalidos > 0
for (const [i, r] of resultados.entries()) {
  const ctx = contextos[i]!
  console.log(`\n== ${ctx.tenantId ? `tenant ${ctx.tenantId}` : ctx.segmento ? `segmento ${ctx.segmento}` : 'core'}: ${Object.keys(r.manifesto.paginas).length} página(s)`)
  for (const [id, p] of Object.entries(r.manifesto.paginas)) {
    const kb = (a?: { bytes: number }) => (a ? `${(a.bytes / 1024).toFixed(1)} KB` : '-')
    console.log(`  ${id.padEnd(28)} ${p.modo.padEnd(8)} ${p.prerenderizada ? 'html' : 'ssr '}  cliente ${kb(p.arquivos.cliente)}  programa ${kb(p.arquivos.programa)}${p.motivos.length ? `  (${p.motivos[0]})` : ''}`)
  }
  console.log(`  escritos ${r.escritos.length}, mantidos ${r.mantidos.length}, removidos ${r.removidos.length}`)
  for (const e of r.erros) { falhou = true; console.error(`  ✗ ${e.pagina}:\n${formataErros(e.erros)}`) }
}
process.exit(falhou ? 1 : 0)
