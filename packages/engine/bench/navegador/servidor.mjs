// Servidor estático para o benchmark: gzip nível 9 pré-calculado (a rede comprimida é o que se mede), sem cache.
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, extname } from 'node:path'
const raiz = process.argv[2], porta = Number(process.argv[3] ?? 4173)
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' }
const cache = new Map()
createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (p.endsWith('/')) p += 'index.html'
  const f = join(raiz, p)
  if (!f.startsWith(raiz) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('nao achei'); return }
  const mt = statSync(f).mtimeMs
  if (!cache.has(f) || cache.get(f).mt !== mt) { const b = readFileSync(f); cache.set(f, { mt, gz: gzipSync(b, { level: 9 }) }) }
  const { gz } = cache.get(f)
  res.writeHead(200, { 'Content-Type': tipos[extname(f)] ?? 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': gz.length, 'Cache-Control': 'no-store' })
  res.end(gz)
}).listen(porta, '127.0.0.1', () => console.log(`servindo ${raiz} em http://127.0.0.1:${porta}`))
