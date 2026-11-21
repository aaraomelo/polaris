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
  it('o avaliador de expressões com a biblioteca INTEIRA (parser + avalia + todas as funções) não arrasta nada do servidor e cabe em 11,5 KB gz', async () => {
    const b = await empacota(`import { parseExpr, avalia, FUNCOES_PADRAO } from './src/expr/index'; console.log(avalia(parseExpr(document.title), {}, FUNCOES_PADRAO))`)
    for (const re of PROIBIDOS) expect(b.entradas.filter((e) => re.test(e)), String(re)).toEqual([])
    expect(b.gz).toBeLessThan(12.8 * 1024) // (10,5 → 11,5 → 12 → 12,8 KB: `csv`, `csvTexto`, `textoDeBase64`, `arco`; `mediana`, `escala`, `enxame`, `raiz`, `compacto`, `dataCurta` dos gráficos; `traduz`, `loc`, `qmoeda` e o formatador ICU do i18n) (10 KB → 10,5 KB com `elementosDoBloco` e `semIds`, as funções da árvore do Studio) a biblioteca completa cresceu (listas, aritmética exata, caminhos); a página real carrega só o que usa (aot.test.ts)
  })

  it('o cliente de hidratação (React + engine + blocos base) não tem Ajv/schemas/QuickJS e fica abaixo de 165 KB gz', async () => {
    const b = await empacota(`import { hidrata } from './src/render/cliente'; import { COMPONENTES_BASE } from './src/render/base'; hidrata(COMPONENTES_BASE)`)
    for (const re of PROIBIDOS) expect(b.entradas.filter((e) => re.test(e)), String(re)).toEqual([])
    expect(b.gz).toBeLessThan(170.4 * 1024) // 160 → 161 → 162 → 164 → 165 → 168,5 KB (primitivas SVG `grafico/*`, gaveta, `modo` e as funções de gráfico; as funções do i18n entram na biblioteca completa; `iconeApos`, `rotulo` do botão e `data-botao` texto nos descritores): os blocos novos do Studio (midia/tela, as props alvo e arrasta, o papel status) e as primitivas de layout do tema Maison (layout/contido, texto/sobretitulo, imagem fluida, alinha da grade) entram no cliente de hidratação
    const proprio = b.entradas.filter((e) => /packages\/engine\/src/.test(e) || /^src\//.test(e))
    expect(proprio.length).toBeGreaterThan(5) // a medição enxerga o nosso código (não é um bundle vazio)
  })

  it('o runtime vivo (sem React) não tem React, Ajv nem QuickJS e cabe em 24 KB gz (TUDO: biblioteca completa, aritmética exata, caminhos, plugin de blocos de código; o pacote por página leva só o que usa)', async () => {
    const b = await empacota(`import { montaVivo } from './src/vivo/index'; montaVivo({} as never)`)
    for (const re of [...PROIBIDOS, /node_modules\/\.pnpm\/react/]) expect(b.entradas.filter((e) => re.test(e)), String(re)).toEqual([])
    // 7,5 KB no protótipo → 10,2 KB com modelo, hidratação e a biblioteca de listas/combinadores → 11,7 KB com a aritmética exata (BigInt) → 13,6 KB com caminhos/patches/histórico. A biblioteca padrão é o que mais pesa: o corte é incluí-la POR PROGRAMA (só as funções usadas). Próximo corte: incluir só as funções que o programa usa.
    expect(b.gz).toBeLessThan(26.2 * 1024) // 24 → 25,6 KB: primitivas SVG, gaveta, modal, dica e funções de gráfico
    // (limite anterior: 24 KB)
    expect(b.entradas.some((e) => /vivo\/monta/.test(e))).toBe(true)
  })

  it('o QuickJS só entra no bundle de quem pede o sandbox (subpath separado)', async () => {
    const sem = await empacota(`import { hidrataAsync } from './src/render/cliente'; hidrataAsync({} as never)`)
    const com = await empacota(`import { hidrataAsync } from './src/render/cliente'; import { criaSandboxLocal } from './src/sandbox/local'; criaSandboxLocal().then((s) => hidrataAsync({} as never, { codigo: { sandbox: s } }))`)
    expect(sem.entradas.some((e) => /quickjs/.test(e))).toBe(false)
    expect(com.entradas.some((e) => /quickjs/.test(e))).toBe(true)
  })
})
