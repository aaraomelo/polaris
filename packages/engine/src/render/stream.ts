import { PassThrough, type Readable } from 'node:stream'
import { createElement } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { iniciaCargas, type OpcoesCarga } from '../dados/carrega'
import { chunksParaPreload, preCarregaBlocos, type ResultadoPreCarga } from './lazy'
import { jsonSeguro } from './json'
import { Pagina, tituloDaPagina, type EntradaPagina } from './pagina'
import type { Programa } from './programa'
import { ID_ESTADO, ID_RAIZ, type EstadoCliente } from './ssr'
import type { Componentes, ErroRuntime } from './tipos'

// ---------------------------------------------------------------------------
// SSR em streaming (Node). O HTML sai assim que o "shell" está pronto; dados marcados com stream: true
// chegam depois, dentro de fronteiras Suspense. Entrada separada (@polaris/engine/servidor): usa node:stream.
// ---------------------------------------------------------------------------

export type OpcoesStream = OpcoesCarga & {
  scripts?: string[]
  lang?: string
  /** robôs/SEO: espera TUDO ficar pronto e envia a página completa (sem esqueletos) */
  esperaTudo?: boolean
  /** padrão true: carrega antes os módulos lazy que a página usa, para o shell já sair completo */
  preCarrega?: boolean
  /** relata falhas de render/bloco (erros de dados vão em `onErro`) */
  onErroRuntime?: (e: ErroRuntime) => void
  /** corta fronteiras que não terminaram (o cliente completa); padrão 20000 ms */
  abortaEmMs?: number
  /** nonce de CSP: vai nos scripts inline que o React emite no streaming e nos <script type=module> */
  nonce?: string
}

export type SaidaStream = {
  status: number
  /** documento HTML completo, em pedaços */
  stream: Readable
  /** resolve quando tudo (inclusive o streaming) foi renderizado */
  tudoPronto: Promise<void>
  abort: () => void
  preCarga: ResultadoPreCarga
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Inicia todas as cargas já, espera só as bloqueantes, e começa a transmitir. Rejeita se o shell falhar
 * (ainda dá tempo de responder 500). Falha de dado ou de fronteira nunca derruba a página.
 */
export async function renderPaginaStream(programa: Programa, componentes: Componentes, opcoes: OpcoesStream): Promise<SaidaStream> {
  const preCarga = opcoes.preCarrega === false ? { carregados: [], falhas: [] } : await preCarregaBlocos(programa, componentes)
  for (const f of preCarga.falhas) opcoes.onErroRuntime?.({ caminho: '/', regra: 'componente-ausente', mensagem: `bloco '${f.interface}' não carregou: ${f.erro}` })

  const cargas = iniciaCargas(programa, opcoes)
  const bloq = await cargas.bloqueantes
  const entrada: EntradaPagina = {
    programa, componentes, dados: bloq.dados, status: bloq.status, erros: bloq.erros, stream: cargas.stream,
    ...(opcoes.params ? { params: opcoes.params } : {}), ...(opcoes.consulta ? { consulta: opcoes.consulta } : {}),
    ...(opcoes.tenant ? { tenant: opcoes.tenant } : {}), ...(opcoes.estado ? { estado: opcoes.estado } : {}),
    ...(opcoes.onErroRuntime ? { onErro: opcoes.onErroRuntime } : {}),
  }

  const estado: EstadoCliente = {
    programa, dados: bloq.dados, status: bloq.status, erros: bloq.erros,
    ...(opcoes.params ? { params: opcoes.params } : {}), ...(opcoes.consulta ? { consulta: opcoes.consulta } : {}),
    ...(opcoes.tenant ? { tenant: opcoes.tenant } : {}), ...(opcoes.estado ? { estado: opcoes.estado } : {}),
  }
  const links = chunksParaPreload(programa, componentes).map((u) => `<link rel="modulepreload" href="${esc(u)}">`).join('')
  const nonce = opcoes.nonce ? ` nonce="${esc(opcoes.nonce)}"` : ''
  const scripts = (opcoes.scripts ?? []).map((s) => `<script type="module"${nonce} src="${esc(s)}"></script>`).join('')
  const prefixo =
    `<!doctype html><html lang="${esc(opcoes.lang ?? 'pt-BR')}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(tituloDaPagina(entrada))}</title>${links}${scripts}</head>` +
    // o estado vem ANTES do conteúdo: o cliente pode hidratar assim que o primeiro trecho chegar
    `<body><script type="application/json" id="${ID_ESTADO}">${jsonSeguro(estado)}</script><div id="${ID_RAIZ}">`
  const sufixo = '</div></body></html>'

  const corpo = new PassThrough()
  const saida = new PassThrough()
  let abort = () => {}
  let resolveTudo!: () => void
  const tudoPronto = new Promise<void>((r) => { resolveTudo = r })
  let timer: ReturnType<typeof setTimeout> | undefined

  await new Promise<void>((resolve, reject) => {
    const r = renderToPipeableStream(createElement(Pagina as never, entrada as never), {
      ...(opcoes.nonce ? { nonce: opcoes.nonce } : {}),
      onShellReady() { if (!opcoes.esperaTudo) { r.pipe(corpo); resolve() } },
      onAllReady() { clearTimeout(timer); if (opcoes.esperaTudo) { r.pipe(corpo); resolve() } resolveTudo() },
      onShellError(e) { clearTimeout(timer); reject(e) },
      // falha dentro de uma fronteira: o React manda o trecho para o cliente completar; a página continua
      onError(e) { opcoes.onErroRuntime?.({ caminho: '/', regra: 'render', mensagem: e instanceof Error ? e.message : String(e) }) },
    })
    abort = () => r.abort()
    timer = setTimeout(() => r.abort(), opcoes.abortaEmMs ?? 20000)
  })

  saida.write(prefixo)
  corpo.on('data', (c: Buffer) => saida.write(c))
  corpo.on('end', () => { saida.write(sufixo); saida.end() })
  corpo.on('error', (e) => saida.destroy(e))
  return { status: 200, stream: saida, tudoPronto, abort, preCarga }
}

/** Lê o stream inteiro como texto (útil em testes e em respostas não-streaming). */
export async function textoDoStream(s: Readable): Promise<string> {
  const partes: Buffer[] = []
  for await (const c of s) partes.push(Buffer.from(c))
  return Buffer.concat(partes).toString('utf8')
}
