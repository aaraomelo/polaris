import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Contexto, Erro, Registry } from '@polaris/schema'
import { compilaEstatico, compilaHtmlVivo, documentoEstatico } from '../estatico/index'
import { compilaPrograma, type Programa } from '../render/programa'
import { jsonSeguro } from '../render/json'
import { elegivelVivo } from '../vivo/monta'
import { empacotaCliente } from './empacota'
import { usoDoPrograma, type Uso } from './uso'

// ---------------------------------------------------------------------------
// BUILD AOT: do registry (schemas) para ARQUIVOS prontos, página a página, com manifesto, hash por conteúdo e invalidação.
//   - determinístico: mesma entrada → mesmos bytes e mesmos nomes (nada de data/hora); hash do conteúdo no nome do arquivo → cache imutável;
//   - incremental: o que não mudou não é reescrito; o que saiu do manifesto é removido (e SÓ o que o manifesto anterior listava);
//   - por página, o modo mais barato que serve: `estatico` (HTML sem JavaScript), `vivo` (HTML + bundle do cliente só com o que usa), `react` (fallback);
//   - escrita atômica (temporário + rename); o manifesto é o último arquivo escrito.
// ---------------------------------------------------------------------------

export type Modo = 'estatico' | 'vivo' | 'react'
export type Arquivo = { nome: string; bytes: number; /** tamanho comprimido (o que vai pela rede) */ gz: number; sha256: string }
export type EntradaManifesto = {
  /** nó que originou a página (para invalidar por versão) */
  no: { id: string; versao: string; escopo: string }
  rota: string
  modo: Modo
  /** por que não um modo mais barato (sempre que modo = react, ou a página tem dados e não foi pré-renderizada) */
  motivos: string[]
  /** HTML completo pré-renderizado no build (só páginas sem dados e sem parâmetros de rota); null = renderizada a cada requisição */
  prerenderizada: boolean
  arquivos: { programa: Arquivo; html?: Arquivo; cliente?: Arquivo }
  uso: Uso
  /** vivo + prerenderizada: hash SHA-256 (base64) do script inline de inicialização, para a CSP */
  cspScript?: string
}
export type Manifesto = { versao: 1; contexto: Contexto; paginas: Record<string, EntradaManifesto> }

export type Resultado = {
  ok: boolean
  manifesto: Manifesto
  escritos: string[]
  mantidos: string[]
  removidos: string[]
  erros: Array<{ pagina: string; erros: Erro[] }>
}

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
const arquivo = (nome: string, conteudo: string): Arquivo => ({ nome, bytes: Buffer.byteLength(conteudo), gz: gzipSync(conteudo, { level: 9 }).length, sha256: sha(conteudo) })
const nomeBase = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')
const chaveContexto = (c: Contexto) => (c.tenantId ? `t-${c.tenantId}` : c.segmento ? `s-${c.segmento}` : 'core')

/** Lê nós de um diretório (recursivo): cada *.json é um nó ou um array de nós. Ordem alfabética (determinística). */
export function nosDoDiretorio(dir: string): unknown[] {
  const out: unknown[] = []
  const anda = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) anda(p)
      else if (e.endsWith('.json')) { const j = JSON.parse(readFileSync(p, 'utf8')) as unknown; if (Array.isArray(j)) out.push(...j); else out.push(j) }
    }
  }
  anda(dir)
  return out
}

const escreve = (caminho: string, conteudo: string) => {
  mkdirSync(dirname(caminho), { recursive: true })
  const tmp = `${caminho}.tmp-${process.pid}`
  writeFileSync(tmp, conteudo)
  renameSync(tmp, caminho)
}

function inicializacao(): string {
  return `Polaris.monta({programa:JSON.parse(document.getElementById('pl-programa').textContent),container:document.getElementById('polaris'),hidrata:true,fechado:true})`
}

type PaginaPronta = { entrada: EntradaManifesto; conteudos: Record<string, string> }

async function constroiPagina(id: string, programa: Programa, no: { id: string; versao: string }, escopo: string): Promise<PaginaPronta> {
  const base = nomeBase(id)
  const progJson = JSON.stringify(programa)
  const hashP = sha(progJson).slice(0, 12)
  const progNome = `${base}.${hashP}.programa.json`
  const conteudos: Record<string, string> = { [progNome]: progJson }
  const temDados = Object.keys(programa.pagina.dados).length > 0
  const rotaDinamica = /[:*]/.test(programa.pagina.rota)
  const uso = usoDoPrograma(programa)
  const motivos: string[] = []
  if (temDados) motivos.push('a página tem dados: o HTML é renderizado a cada requisição')
  if (rotaDinamica) motivos.push('a rota tem parâmetros: o HTML é renderizado a cada requisição')
  const prerenderizavel = !temDados && !rotaDinamica
  const arquivos: EntradaManifesto['arquivos'] = { programa: arquivo(progNome, progJson) }
  const entrada: EntradaManifesto = { no: { id: no.id, versao: no.versao, escopo }, rota: programa.pagina.rota, modo: 'react', motivos, prerenderizada: false, arquivos, uso }

  const est = compilaEstatico(programa)
  if (est.ok) {
    entrada.modo = 'estatico'
    if (prerenderizavel) {
      const r = est.pagina.render({})
      const html = documentoEstatico({ corpo: r.corpo, titulo: r.titulo })
      const nome = `${base}.${sha(html).slice(0, 12)}.html`
      conteudos[nome] = html; arquivos.html = arquivo(nome, html); entrada.prerenderizada = true
    }
    return { entrada, conteudos }
  }
  const v = elegivelVivo(programa)
  if (!v.ok) { entrada.motivos = [...motivos, ...v.motivos.map((m) => `${m.caminho}: ${m.motivo}`)]; return { entrada, conteudos } }

  entrada.modo = 'vivo'
  const pacote = await empacotaCliente(programa)
  if (!pacote.ok) throw new Error('o pacote do cliente foi recusado depois de elegível') // inatingível: mesma checagem
  const jsNome = `${base}.${sha(pacote.pacote.codigo).slice(0, 12)}.js`
  conteudos[jsNome] = pacote.pacote.codigo; arquivos.cliente = arquivo(jsNome, pacote.pacote.codigo)
  if (prerenderizavel) {
    const h = compilaHtmlVivo(programa)
    if (!h.ok) throw new Error('HTML do servidor recusado para página elegível')
    const r = h.pagina.render({})
    const ini = inicializacao()
    const titulo = r.titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title></head><body><div id="polaris">${r.corpo}</div><script type="application/json" id="pl-programa">${jsonSeguro(programa)}</script><script src="${jsNome}"></script><script>${ini}</script></body></html>`
    const nome = `${base}.${sha(html).slice(0, 12)}.html`
    conteudos[nome] = html; arquivos.html = arquivo(nome, html); entrada.prerenderizada = true
    entrada.cspScript = `sha256-${createHash('sha256').update(ini).digest('base64')}`
  }
  return { entrada, conteudos }
}

export type OpcoesBuild = {
  /** diretório de saída (cada contexto vai para uma subpasta: core, t-<tenant>, s-<segmento>) */
  destino: string
  contextos?: Contexto[]
}

/** Constrói todas as páginas publicadas do registry em cada contexto. Nunca lança por conteúdo inválido: devolve `erros` (e `ok: false`). */
export async function construirAot(reg: Registry, opcoes: OpcoesBuild): Promise<Resultado[]> {
  const resultados: Resultado[] = []
  for (const ctx of opcoes.contextos ?? [{}]) {
    const dir = resolve(opcoes.destino, chaveContexto(ctx))
    const manifestoPath = join(dir, 'manifesto.json')
    const anterior: Manifesto | null = existsSync(manifestoPath) ? (JSON.parse(readFileSync(manifestoPath, 'utf8')) as Manifesto) : null
    const paginas: Record<string, EntradaManifesto> = {}
    const conteudos: Record<string, string> = {}
    const erros: Resultado['erros'] = []
    for (const id of reg.ids('pagina')) {
      const r = reg.resolve('pagina', id, ctx)
      if (!r) continue
      const c = compilaPrograma(reg, r.no, ctx)
      if (!c.ok) { erros.push({ pagina: id, erros: c.erros }); continue }
      const p = await constroiPagina(id, c.programa, { id: r.no.id, versao: r.no.versao }, r.escopo)
      paginas[id] = p.entrada
      Object.assign(conteudos, p.conteudos)
    }
    const manifesto: Manifesto = { versao: 1, contexto: ctx, paginas }
    const escritos: string[] = [], mantidos: string[] = []
    for (const [nome, conteudo] of Object.entries(conteudos).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const alvo = join(dir, nome)
      if (existsSync(alvo) && sha(readFileSync(alvo)) === sha(conteudo)) { mantidos.push(nome); continue }
      escreve(alvo, conteudo); escritos.push(nome)
    }
    // remove SÓ o que o manifesto anterior listava e o atual não lista mais (nunca arquivos estranhos)
    const novos = new Set(Object.keys(conteudos))
    const removidos: string[] = []
    for (const e of Object.values(anterior?.paginas ?? {})) {
      for (const a of Object.values(e.arquivos)) if (a && !novos.has(a.nome) && existsSync(join(dir, a.nome))) { rmSync(join(dir, a.nome)); removidos.push(a.nome) }
    }
    const texto = `${JSON.stringify(manifesto, null, 2)}\n`
    if (!existsSync(manifestoPath) || readFileSync(manifestoPath, 'utf8') !== texto) { mkdirSync(dir, { recursive: true }); escreve(manifestoPath, texto); escritos.push('manifesto.json') }
    resultados.push({ ok: erros.length === 0, manifesto, escritos, mantidos, removidos: removidos.sort(), erros })
  }
  return resultados
}
