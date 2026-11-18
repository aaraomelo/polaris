import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { FUNCOES_EXATAS } from '../expr/biblioteca'
import { FUNCOES_PADRAO } from '../expr/biblioteca'
import { ORDEM_SUPERIOR } from '../expr/ordem-superior'
import type { Programa } from '../render/programa'
import { DESCRITORES_BASE } from '../vivo/blocos'
import { elegivelVivo } from '../vivo/monta'
import { usoDoPrograma, type Uso } from './uso'

// ---------------------------------------------------------------------------
// BUNDLE DE CLIENTE POR PÁGINA (AOT). O runtime vivo é o mesmo para todas as páginas; o que muda é a biblioteca: este módulo gera uma
// entrada que importa UMA A UMA as funções e os descritores de bloco que a página usa, e o esbuild descarta o resto (tree-shaking de
// exports nomeados). Uma página sem aritmética exata não carrega BigInt; sem listas, não carrega a biblioteca de listas.
// Server/build only: usa esbuild e node:zlib; nunca entra num bundle de cliente.
// ---------------------------------------------------------------------------

const RAIZ = fileURLToPath(new URL('..', import.meta.url)) // .../packages/engine/src/

const ident = (nome: string) => nome.replace(/\W/g, '_')
const ehExata = (nome: string) => Object.prototype.hasOwnProperty.call(FUNCOES_EXATAS, nome)
const temFuncao = (nome: string) => Object.prototype.hasOwnProperty.call(FUNCOES_PADRAO, nome)

export type Entrada = { fonte: string; uso: Uso }

/** Fonte JS da entrada do cliente desta página: importa só o que ela usa e expõe `monta(opcoes)`. */
export function geraEntrada(programa: Programa, uso: Uso = usoDoPrograma(programa)): Entrada {
  const imports: string[] = [`import { montaVivoNucleo } from ${JSON.stringify(`${RAIZ}vivo/monta.ts`)}`, `import { iniciaDoDocumento, iniciaQuando } from ${JSON.stringify(`${RAIZ}vivo/fila.ts`)}`]
  const fs: string[] = [], ds: string[] = []
  for (const f of uso.funcoes) {
    if (!temFuncao(f)) throw new Error(`função '${f}' não existe na biblioteca`)
    const [modulo, prefixo] = ehExata(f) ? ['expr/exato.ts', 'fq_'] : Object.prototype.hasOwnProperty.call(ORDEM_SUPERIOR, f) ? ['expr/ordem-superior.ts', 'f_'] : ['expr/funcoes.ts', 'f_']
    imports.push(`import { ${prefixo}${ident(f)} } from ${JSON.stringify(`${RAIZ}${modulo}`)}`)
    fs.push(`${JSON.stringify(f)}: ${prefixo}${ident(f)}`)
  }
  for (const i of uso.interfaces) {
    if (!Object.prototype.hasOwnProperty.call(DESCRITORES_BASE, i)) continue // bloco sem descritor: o elegivelVivo já recusa
    imports.push(`import { d_${ident(i)} } from ${JSON.stringify(`${RAIZ}vivo/blocos.ts`)}`)
    ds.push(`${JSON.stringify(i)}: d_${ident(i)}`)
  }
  if (uso.codigos.length) imports.push(`import { constroiCodigo } from ${JSON.stringify(`${RAIZ}vivo/codigo.ts`)}`)
  const fonte = [
    ...imports,
    `const funcoes = { ${fs.join(', ')} }`,
    `const descritores = { ${ds.join(', ')} }`,
    `export function monta(opcoes) { return montaVivoNucleo({ ...opcoes, funcoes, descritores${uso.codigos.length ? ', blocoCodigo: constroiCodigo' : ''} }) }`,
    '// inicia(): monta a partir do documento (programa e estado embutidos + fila de dados em streaming)',
    'export function inicia(extra) { return iniciaDoDocumento(monta, extra) }',
    "if (typeof window !== 'undefined' && window.__PL && window.__PL.auto) iniciaQuando(() => inicia())",
    '',
  ].join('\n')
  return { fonte, uso }
}

export type Pacote = {
  codigo: string
  bytes: number
  gz: number
  uso: Uso
  /** arquivos do engine que entraram, com os bytes que cada um contribuiu para a saída (para auditar o que foi descartado) */
  contribuicao: Record<string, number>
}

export type Opcoes = { minify?: boolean }

/** Gera e empacota o cliente da página (IIFE com `Polaris.monta`). Recusa páginas que o runtime vivo não suporta (devolve os motivos). */
export async function empacotaCliente(programa: Programa, opcoes: Opcoes = {}): Promise<{ ok: true; pacote: Pacote } | { ok: false; motivos: Array<{ caminho: string; motivo: string }> }> {
  const el = elegivelVivo(programa)
  if (!el.ok) return el
  const { fonte, uso } = geraEntrada(programa)
  const { build } = await import('esbuild')
  const r = await build({
    stdin: { contents: fonte, resolveDir: RAIZ, loader: 'ts', sourcefile: 'entrada-polaris.ts' },
    bundle: true, minify: opcoes.minify ?? true, format: 'iife', globalName: 'Polaris', platform: 'browser', write: false, metafile: true, logLevel: 'silent',
    treeShaking: true, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const codigo = r.outputFiles[0]!.text
  const saida = Object.values(r.metafile!.outputs)[0]!
  const contribuicao: Record<string, number> = {}
  for (const [arq, v] of Object.entries(saida.inputs)) if (v.bytesInOutput > 0) contribuicao[arq.replace(/^(?:.*\/)?src\//, '')] = v.bytesInOutput
  return { ok: true, pacote: { codigo, bytes: Buffer.byteLength(codigo), gz: gzipSync(Buffer.from(codigo), { level: 9 }).length, uso, contribuicao } }
}

let ilhaFormulario: Promise<string> | null = null
/** O pacote da ILHA do formulário (IIFE `PolarisFormularios`): máscaras, formatos, validador e a montagem dos campos. Independe da página: um só para todas (cache de processo). */
export function empacotaIlhaFormulario(): Promise<string> {
  ilhaFormulario ??= import('esbuild').then(async ({ build }) => {
    const r = await build({
      entryPoints: [`${RAIZ}formulario/cliente.ts`], bundle: true, minify: true, format: 'iife', globalName: 'PolarisFormularios', platform: 'browser', write: false, logLevel: 'silent',
      treeShaking: true, define: { 'process.env.NODE_ENV': '"production"' },
    })
    return r.outputFiles[0]!.text
  })
  return ilhaFormulario
}
