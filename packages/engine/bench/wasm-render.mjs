// JS compilado vs WASM (gerado pelo traduz do Tiffany) para o MESMO render: lista de cartões.  node bench/wasm-render.mjs <traduz> <dir>
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const [traduz, dir] = process.argv.slice(2)

// pedaços estáticos do HTML (o que seria o "template" compilado do IR)
const NBSP = ' '
const pedacos = ['<div style="display:flex;flex-direction:column;gap:4px"><h3>', '</h3><p>R$' + NBSP, '</p><a href="/p/', '">Ver produto</a></div>']
const enc = new TextEncoder(), dec = new TextDecoder()
const TPL = 0, DADOS = 4096, SAIDA = 262144, ARENA = 1 << 20
const BASE = 8 // a arena[] do traduz começa no byte 8 da memória exportada (medido: arena[0] cai em 8)
const tplBytes = pedacos.map((p) => enc.encode(p))
const off = []; let o = TPL; for (const b of tplBytes) { off.push(o); o += b.length }
const tamanhos = tplBytes.map((b) => b.length)
// a ÚNICA fonte da verdade do template gera o C: offsets e tamanhos entram como literais
const c = `unsigned char arena[${ARENA}];
static int copia(int src, int n, int dst){ int i = 0; while(i < n){ arena[dst + i] = arena[src + i]; i++; } return n; }
static int rd32(int o){ return arena[o] | (arena[o+1] << 8) | (arena[o+2] << 16) | (arena[o+3] << 24); }
static int esc(int src, int n, int dst){
  int m = 0; int i = 0;
  while(i < n){
    int c = arena[src + i];
    if(c == 60){ arena[dst+m]=38; m++; arena[dst+m]=108; m++; arena[dst+m]=116; m++; arena[dst+m]=59; m++; }
    else if(c == 62){ arena[dst+m]=38; m++; arena[dst+m]=103; m++; arena[dst+m]=116; m++; arena[dst+m]=59; m++; }
    else if(c == 38){ arena[dst+m]=38; m++; arena[dst+m]=97; m++; arena[dst+m]=109; m++; arena[dst+m]=112; m++; arena[dst+m]=59; m++; }
    else if(c == 34){ arena[dst+m]=38; m++; arena[dst+m]=113; m++; arena[dst+m]=117; m++; arena[dst+m]=111; m++; arena[dst+m]=116; m++; arena[dst+m]=59; m++; }
    else { arena[dst+m] = c; m++; }
    i++;
  }
  return m;
}
static int escreve_int(int v, int dst){
  if(v == 0){ arena[dst] = 48; return 1; }
  int n = 0; int t = v;
  while(t > 0){ n++; t = t / 10; }
  int k = n - 1; t = v;
  while(t > 0){ arena[dst + k] = 48 + (t % 10); t = t / 10; k--; }
  return n;
}
static int preco(int cents, int dst){
  int m = 0;
  int inteiro = cents / 100; int fr = cents % 100;
  int milhoes = inteiro / 1000000; int milhares = (inteiro / 1000) % 1000; int unid = inteiro % 1000;
  if(milhoes > 0){ m += escreve_int(milhoes, dst + m); arena[dst+m] = 46; m++; }
  if(milhoes > 0 || milhares > 0){
    if(milhoes > 0){ if(milhares < 100) { arena[dst+m]=48; m++; } if(milhares < 10) { arena[dst+m]=48; m++; } if(milhares == 0) { arena[dst+m]=48; m++; } else { m += escreve_int(milhares, dst + m); } }
    else { m += escreve_int(milhares, dst + m); }
    arena[dst+m] = 46; m++;
    if(unid < 100){ arena[dst+m]=48; m++; } if(unid < 10){ arena[dst+m]=48; m++; }
    if(unid == 0){ arena[dst+m]=48; m++; } else { m += escreve_int(unid, dst + m); }
  } else { m += escreve_int(unid, dst + m); }
  arena[dst+m] = 44; m++;
  arena[dst+m] = 48 + (fr / 10); m++; arena[dst+m] = 48 + (fr % 10); m++;
  return m;
}
int render(int dados, int n, int out){
  int m = 0; int p = dados; int i = 0;
  while(i < n){
    int id = rd32(p); int cents = rd32(p + 4); int len = rd32(p + 8);
    m += copia(${off[0]}, ${tamanhos[0]}, out + m);
    m += esc(p + 12, len, out + m);
    m += copia(${off[1]}, ${tamanhos[1]}, out + m);
    m += preco(cents, out + m);
    m += copia(${off[2]}, ${tamanhos[2]}, out + m);
    m += escreve_int(id, out + m);
    m += copia(${off[3]}, ${tamanhos[3]}, out + m);
    p += 12 + len;
    i++;
  }
  return m;
}
`
writeFileSync(`${dir}/render.c`, c)
console.log('traduz:', execFileSync(traduz, [`${dir}/render.c`, '-o', `${dir}/render.wasm`], { encoding: 'utf8' }).trim().split('-1 ').pop())
const mod = new WebAssembly.Module(readFileSync(`${dir}/render.wasm`))
const inst = new WebAssembly.Instance(mod, {})
const mem = Object.values(inst.exports).find((x) => x instanceof WebAssembly.Memory)
console.log(`módulo: ${readFileSync(`${dir}/render.wasm`).length} bytes; memória ${(mem.buffer.byteLength / 1024).toFixed(0)} KB (arena pedida: ${ARENA >> 10} KB)`)
let u8 = new Uint8Array(mem.buffer)
tplBytes.forEach((b, i) => u8.set(b, BASE + off[i]))   // o template estático é gravado UMA vez

// ---- as três formas ----
const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const renderJS = (ps) => { let o = ''; for (const p of ps) o += '<div style="display:flex;flex-direction:column;gap:4px"><h3>' + esc(p.nome) + '</h3><p>' + fmt.format(p.preco) + '</p><a href="/p/' + p.id + '">Ver produto</a></div>'; return o }
// "melhor JS": escape em UMA passada (sem regex) e preço por aritmética inteira (sem Intl), como o WASM faz
const escRapido = (s) => { let o = '', ini = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); const r = c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 38 ? '&amp;' : c === 34 ? '&quot;' : null; if (r !== null) { o += s.slice(ini, i) + r; ini = i + 1 } } return ini === 0 ? s : o + s.slice(ini) }
const p3 = (n) => (n < 10 ? '00' : n < 100 ? '0' : '') + n
const precoInt = (cents) => { const inteiro = Math.floor(cents / 100), fr = cents % 100, mil = Math.floor(inteiro / 1000), un = inteiro % 1000; return (mil > 0 ? mil + '.' + p3(un) : String(un)) + ',' + (fr < 10 ? '0' : '') + fr }
const renderJSRapido = (ps) => { let o = ''; for (const p of ps) o += '<div style="display:flex;flex-direction:column;gap:4px"><h3>' + escRapido(p.nome) + '</h3><p>R$' + NBSP + precoInt(Math.round(p.preco * 100)) + '</p><a href="/p/' + p.id + '">Ver produto</a></div>'; return o }
const dv = () => new DataView(mem.buffer)
function empacota(ps) {   // JS → memória do WASM (custo REAL de entrada)
  const d = dv(); u8 = new Uint8Array(mem.buffer); let p = BASE + DADOS
  for (const x of ps) { d.setInt32(p, x.id, true); d.setInt32(p + 4, Math.round(x.preco * 100), true); const r = enc.encodeInto(x.nome, u8.subarray(p + 12)); d.setInt32(p + 8, r.written, true); p += 12 + r.written }
  return p - BASE - DADOS
}
const renderWasmBytes = (ps) => { empacota(ps); const m = inst.exports.render(DADOS, ps.length, SAIDA); return u8.subarray(BASE + SAIDA, BASE + SAIDA + m) }
const renderWasmCompleto = (ps) => { empacota(ps); const m = inst.exports.render(DADOS, ps.length, SAIDA); return dec.decode(u8.subarray(BASE + SAIDA, BASE + SAIDA + m)) }

function mede(f, n = 60) { for (let i = 0; i < 12; i++) f(); const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); f(); t.push(performance.now() - a) } t.sort((x, y) => x - y); return t[n >> 1] }
const linha = (nome, ms, base) => `    ${nome.padEnd(58)} ${ms.toFixed(3).padStart(8)} ms   ${(base / ms).toFixed(2).padStart(6)}x`
for (const N of [200, 1000, 5000]) {
  const ps = Array.from({ length: N }, (_, i) => ({ id: i, nome: `Produto ${i} <b>&</b>`, preco: 10 + i * 1.5 }))
  const a = renderJS(ps), r = renderJSRapido(ps), b = renderWasmCompleto(ps)
  console.log(`\nN=${N} (${(a.length / 1024).toFixed(0)} KB)  saídas idênticas: JS(Intl+regex)=WASM ${a === b}, JS(rápido)=WASM ${r === b}`)
  const tJS = mede(() => renderJS(ps)), tRapido = mede(() => renderJSRapido(ps))
  const tJSBytes = mede(() => Buffer.from(renderJSRapido(ps), 'utf8'))   // o que o socket recebe: bytes UTF-8
  const tWasmBytes = mede(() => renderWasmBytes(ps))                      // empacotar + kernel; os bytes já estão prontos
  empacota(ps)
  const tKernel = mede(() => inst.exports.render(DADOS, N, SAIDA)), tPack = mede(() => empacota(ps))
  console.log(linha('JS com regex + Intl (o que escrevi primeiro)', tJS, tRapido))
  console.log(linha('JS RÁPIDO (1 passada, aritmética inteira) → string', tRapido, tRapido))
  console.log(linha('JS RÁPIDO → bytes UTF-8 (o que vai ao socket)', tJSBytes, tRapido))
  console.log(linha('WASM: empacotar + kernel → bytes (sem decodificar)', tWasmBytes, tRapido) + `   [empacotar ${tPack.toFixed(3)} + kernel ${tKernel.toFixed(3)}]`)
  console.log(`    >>> contra o melhor JS entregando bytes: WASM é ${(tJSBytes / tWasmBytes).toFixed(2)}x mais rápido; só o kernel: ${(tJSBytes / tKernel).toFixed(2)}x`)
}
