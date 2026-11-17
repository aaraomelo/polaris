import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Orçamento do que vai para o NAVEGADOR. O que o servidor precisa (Ajv, schemas, compilador) nunca pode entrar aqui:
// uma única importação de valor errada já custou 115 KB gz (medido) antes desta guarda existir.

const raiz = join(__dirname, '..')
async function empacota(entrada: string) {
  const r = await build({
    stdin: { contents: entrada, resolveDir: raiz, loader: 'ts' }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, metafile: true, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const codigo = r.outputFiles[0]!.contents
  const entradas = Object.keys(Object.values(r.metafile!.outputs)[0]!.inputs)
  return { gz: gzipSync(Buffer.from(codigo), { level: 9 }).length, min: codigo.length, entradas }
}
const PROIBIDOS = [/node_modules\/\.pnpm\/ajv@/, /fast-uri/, /ajv-formats/, /packages\/schema\/schemas\//, /quickjs/, /node:/]

describe('orçamento do bundle do cliente', () => {
  it('o avaliador de expressões (parser + avalia + funções) não arrasta nada do servidor e cabe em 8 KB gz', async () => {
    const b = await empacota(`import { parseExpr, avalia, FUNCOES_PADRAO } from './src/expr/index'; console.log(avalia(parseExpr(document.title), {}, FUNCOES_PADRAO))`)
    for (const re of PROIBIDOS) expect(b.entradas.filter((e) => re.test(e)), String(re)).toEqual([])
    expect(b.gz).toBeLessThan(8 * 1024)
  })

  it('o cliente de hidratação (React + engine + blocos base) não tem Ajv/schemas/QuickJS e fica abaixo de 160 KB gz', async () => {
    const b = await empacota(`import { hidrata } from './src/render/cliente'; import { COMPONENTES_BASE } from './src/render/base'; hidrata(COMPONENTES_BASE)`)
    for (const re of PROIBIDOS) expect(b.entradas.filter((e) => re.test(e)), String(re)).toEqual([])
    expect(b.gz).toBeLessThan(160 * 1024)
    const proprio = b.entradas.filter((e) => /packages\/engine\/src/.test(e) || /^src\//.test(e))
    expect(proprio.length).toBeGreaterThan(5) // a medição enxerga o nosso código (não é um bundle vazio)
  })

  it('o runtime vivo (sem React) não tem React, Ajv nem QuickJS e cabe em 14 KB gz (avaliador com listas e aritmética exata, modelo, ações e blocos base inclusos)', async () => {
    const b = await empacota(`import { montaVivo } from './src/vivo/index'; montaVivo({} as never)`)
    for (const re of [...PROIBIDOS, /node_modules\/\.pnpm\/react/]) expect(b.entradas.filter((e) => re.test(e)), String(re)).toEqual([])
    // 7,5 KB no protótipo → 10,2 KB com modelo, hidratação e a biblioteca de listas/combinadores → 11,7 KB com a aritmética exata (BigInt). Próximo corte: incluir só as funções que o programa usa.
    expect(b.gz).toBeLessThan(14 * 1024)
    expect(b.entradas.some((e) => /vivo\/monta/.test(e))).toBe(true)
  })

  it('o QuickJS só entra no bundle de quem pede o sandbox (subpath separado)', async () => {
    const sem = await empacota(`import { hidrataAsync } from './src/render/cliente'; hidrataAsync({} as never)`)
    const com = await empacota(`import { hidrataAsync } from './src/render/cliente'; import { criaSandboxLocal } from './src/sandbox/local'; criaSandboxLocal().then((s) => hidrataAsync({} as never, { codigo: { sandbox: s } }))`)
    expect(sem.entradas.some((e) => /quickjs/.test(e))).toBe(false)
    expect(com.entradas.some((e) => /quickjs/.test(e))).toBe(true)
  })
})
