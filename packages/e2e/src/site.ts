import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { registraBase } from '@polaris/engine'
import { construirAot, type Manifesto } from '@polaris/engine/aot'
import { registraCommerce } from '@polaris/engine/commerce'
import { registraTemas } from '@polaris/engine/tema'
import { Registry } from '@polaris/schema'

// Os cenários de E2E NASCEM dos schemas: cada exemplo declarado num bloco (`spec.exemplos`) vira uma PÁGINA, construída pelo mesmo AOT da produção e servida com a mesma CSP.
// Bloco novo com exemplo = cenário novo, sem escrever teste.

export type Cenario = { id: string; interface: string; titulo: string; descricao: string; rota: string; modo: 'estatico' | 'vivo' | 'react'; html: string; interativo: boolean }
export type Site = { url: string; cenarios: Cenario[]; registry: Registry; dir: string; fecha(): Promise<void> }
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

export function registryDosBlocos(): Registry { const r = new Registry(); registraBase(r); registraTemas(r); registraCommerce(r); return r }

/** os exemplos dos blocos como páginas do registry (o mesmo que o catálogo faz para a documentação) */
export function paginasDeExemplo(reg: Registry): Array<{ id: string; interface: string; titulo: string; descricao: string; rota: string }> {
  const out: Array<{ id: string; interface: string; titulo: string; descricao: string; rota: string }> = []
  for (const i of reg.ids('bloco')) {
    const spec = reg.resolve('bloco', i)!.no.spec as { exemplos?: Array<{ titulo: string; descricao?: string; instancia: unknown }> }
    for (const [k, e] of (spec.exemplos ?? []).entries()) {
      const id = `e2e.${slug(i)}.${k}`, rota = `/e2e/${slug(i)}-${k}`
      reg.registra({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota, titulo: e.titulo, raiz: e.instancia } } as never)
      out.push({ id, interface: i, titulo: e.titulo, descricao: e.descricao ?? '', rota })
    }
  }
  return out
}

export type OpcoesSite = { /** muda o HTML servido de uma rota (para provar que os detectores enxergam página quebrada) */ adultera?: (rota: string, html: string) => string; csp?: boolean }

export async function criaSite(reg: Registry = registryDosBlocos(), o: OpcoesSite = {}): Promise<Site> {
  const base = paginasDeExemplo(reg)
  const dir = mkdtempSync(join(tmpdir(), 'polaris-e2e-'))
  const [r] = await construirAot(reg, { destino: dir, contextos: [{}] })
  if (!r || r.erros.length) throw new Error(`o AOT recusou páginas: ${r?.erros.map((e) => e.pagina).join(', ')}`)
  const manifesto: Manifesto = r.manifesto, raiz = join(dir, 'core')
  const porRota = new Map<string, { html: string; csp: string; modo: string }>()
  const cenarios: Cenario[] = []
  for (const b of base) {
    const e = manifesto.paginas[b.id]; if (!e?.arquivos.html) throw new Error(`a página ${b.id} não foi pré-renderizada (modo ${e?.modo}); o E2E exige HTML pronto`)
    const html = readFileSync(join(raiz, e.arquivos.html.nome), 'utf8')
    porRota.set(b.rota, { html, csp: e.cspScript ?? '', modo: e.modo })
    cenarios.push({ ...b, modo: e.modo, html: e.arquivos.html.nome, interativo: e.modo !== 'estatico' })
  }
  const csp = (script: string) => `default-src 'none'; script-src 'self'${script ? ` '${script}'` : ''}; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  const srv: Server = createServer((req, res) => {
    const caminho = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    const pg = porRota.get(caminho)
    if (caminho === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return } // o navegador pede o ícone sozinho, uma vez por origem
    const cab = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
    if (pg) { const h = o.adultera ? o.adultera(caminho, pg.html) : pg.html; res.writeHead(200, { ...cab, 'content-type': 'text/html; charset=utf-8', ...(o.csp === false ? {} : { 'content-security-policy': csp(pg.csp) }) }); res.end(h); return }
    // os ativos têm nome com HASH do conteúdo (únicos) e a página os referencia por caminho relativo: o servidor os acha pelo NOME, de qualquer rota
    if (/^\/(?:.*\/)?exemplos\/[\w.-]+\.svg$/.test(caminho)) { res.writeHead(200, { ...cab, 'content-type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#ccc"/></svg>'); return }
    const f = normalize(join(raiz, caminho.split('/').pop() ?? ''))
    if (f.startsWith(raiz) && existsSync(f) && statSync(f).isFile()) { res.writeHead(200, { ...cab, 'content-type': f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/json' }); res.end(readFileSync(f)); return }
    res.writeHead(404, cab); res.end('nao achei')
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const porta = (srv.address() as { port: number }).port
  return { url: `http://127.0.0.1:${porta}`, cenarios, registry: reg, dir, fecha: async () => { await new Promise<void>((ok) => srv.close(() => ok())); rmSync(dir, { recursive: true, force: true }) } }
}
