// Medição em Chrome real COM limitação de CPU e de rede e cliques de verdade (CDP direto, sem dependências).
//   node bench/navegador/cdp.mjs [rodadas=3]      (precisa de bench/navegador/saida gerado e de google-chrome)
// Por variante (react|vivo) e perfil: carga (FCP, long tasks, 1º clique que funciona) e INP-like (Event Timing de cliques reais).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as espera } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const aqui = fileURLToPath(new URL('.', import.meta.url))
const rodadas = Number(process.argv[2] ?? 3)
const PORTA_CHROME = 9333, PORTA_SRV = 4190
const TODOS = [
  { nome: 'sem limite', cpu: 1, rede: null },
  { nome: 'celular médio (CPU 4×, 4G lenta 1,6 Mbps/150 ms)', cpu: 4, rede: { latency: 150, down: (1.6 * 1e6) / 8, up: (0.75 * 1e6) / 8 } },
  { nome: 'celular fraco (CPU 6×, 4G lenta)', cpu: 6, rede: { latency: 150, down: (1.6 * 1e6) / 8, up: (0.75 * 1e6) / 8 } },
]
const PERFIS = process.env.SO ? [TODOS[Number(process.env.SO)]] : TODOS
const VARIANTES = ['react-900', 'vivo-900']

const srv = spawn(process.execPath, [join(aqui, 'servidor.mjs'), resolve(aqui, 'saida'), String(PORTA_SRV)], { stdio: 'ignore' })
const dir = mkdtempSync(join(tmpdir(), 'pl-chrome-'))
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${PORTA_CHROME}`, `--user-data-dir=${dir}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
const fim = () => { try { chrome.kill() } catch {} try { srv.kill() } catch {} try { rmSync(dir, { recursive: true, force: true }) } catch {} }
process.on('exit', fim)

async function aberto() { for (let i = 0; i < 100; i++) { try { return await (await fetch(`http://127.0.0.1:${PORTA_CHROME}/json/version`)).json() } catch { await espera(100) } } throw new Error('chrome não subiu') }
const v = await aberto()

async function cliente() {
  const alvo = await (await fetch(`http://127.0.0.1:${PORTA_CHROME}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
  let n = 0; const pend = new Map(), ouvintes = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const { ok, ko } = pend.get(d.id); pend.delete(d.id); d.error ? ko(new Error(d.error.message)) : ok(d.result) } else ouvintes.forEach((f) => f(d)) }
  const send = (method, params = {}) => new Promise((ok, ko) => { const id = ++n; pend.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'erro'); return r.result.value }
  return { send, ev, ouvintes, fecha: async () => { ws.close(); await fetch(`http://127.0.0.1:${PORTA_CHROME}/json/close/${alvo.id}`) } }
}

const OBSERVA = `(() => { window.__EV = []; window.__LT = 0; window.__FCP = null
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__EV.push({ nome: e.name, dur: e.duration, alvo: e.target && e.target.id }) }).observe({ type: 'event', durationThreshold: 16, buffered: true }) } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LT += Math.max(0, e.duration - 50) }).observe({ type: 'longtask', buffered: true }) } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__FCP = e.startTime }).observe({ type: 'paint', buffered: true }) } catch {}
})()`

const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1] }
async function clica(c, id) {
  const r = await c.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return null; e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2] })()`)
  if (!r) return false
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 })
  return true
}

async function uma(variante, perfil) {
  const c = await cliente()
  await c.send('Page.enable'); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true })
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVA })
  await c.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu })
  if (perfil.rede) await c.send('Network.emulateNetworkConditions', { offline: false, latency: perfil.rede.latency, downloadThroughput: perfil.rede.down, uploadThroughput: perfil.rede.up })
  const t0 = Date.now()
  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORTA_SRV}/${variante}/` })
  // espera o 1º clique que funciona (a harness faz o polling) ou 90 s
  let tti = null
  for (let i = 0; i < 1500 && typeof tti !== 'number'; i++) { await espera(100); try { tti = await c.ev('window.__M && window.__M.tti') } catch {} }
  if (process.env.DEPURA) console.error(variante, perfil.nome, "tti após", Date.now() - t0, "ms; M =", JSON.stringify(await c.ev("JSON.stringify(window.__M)")), "fcp", await c.ev("window.__FCP"))
  const carga = await c.ev('({ fcp: window.__FCP, lt: Math.round(window.__LT), tti: window.__M && window.__M.tti, dcl: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart) })')
  await c.ev('window.__EV.length = 0')
  // cliques REAIS; um de cada vez, esperando o quadro seguinte
  const seq = [['b-n', 8], ['b-um', 8], ['b-add', 5], ['b-rem', 5], ['b-inv', 4]]
  for (const [id, k] of seq) for (let i = 0; i < k; i++) { await clica(c, id); await espera(250 * Math.max(1, perfil.cpu / 2)) }
  await espera(500)
  const evs = await c.ev('window.__EV.filter(e => e.nome === "click" || e.nome === "pointerup" || e.nome === "mouseup")')
  const por = {}
  for (const [id] of seq) por[id] = evs.filter((e) => e.nome === 'click' && e.alvo === id).map((e) => e.dur)
  await c.fecha()
  return { carga: { ...carga, ms_total: Date.now() - t0 }, por }
}

const saida = {}
for (const p of PERFIS) {
  for (const va of VARIANTES) {
    const rs = []
    for (let i = 0; i < rodadas; i++) rs.push(await uma(va, p))
    const ids = ['b-n', 'b-um', 'b-add', 'b-rem', 'b-inv']
    const inp = {}
    for (const id of ids) { const todos = rs.flatMap((r) => r.por[id]); inp[id] = { mediana: med(todos), max: todos.length ? Math.max(...todos) : null, amostras_lentas: todos.length } }
    saida[`${p.nome} | ${va}`] = { fcp_ms: med(rs.map((r) => r.carga.fcp).filter((x) => x != null)), tti_ms: med(rs.map((r) => r.carga.tti).filter((x) => x != null)), long_tasks_ms: med(rs.map((r) => r.carga.lt)), inp }
    console.log(`${p.nome} | ${va}`, JSON.stringify(saida[`${p.nome} | ${va}`]))
  }
}
if (process.argv.includes('--verifica')) {
  const { readFileSync } = await import('node:fs')
  const orc = JSON.parse(readFileSync(new URL('../../orcamento.json', import.meta.url), 'utf8')).navegador
  const falhas = []
  for (const [k, r] of Object.entries(saida)) {
    if (!k.includes('vivo') || !k.includes('CPU 4×')) continue
    if (r.tti_ms > orc.tti_ms) falhas.push(`${k}: TTI ${r.tti_ms.toFixed(0)} > ${orc.tti_ms}`)
    if (r.long_tasks_ms > orc.long_tasks_ms) falhas.push(`${k}: long tasks ${r.long_tasks_ms} > ${orc.long_tasks_ms}`)
    for (const [id, lim] of Object.entries(orc.inp_pior_ms)) if (r.inp[id].max !== null && r.inp[id].max > lim) falhas.push(`${k}: INP ${id} ${r.inp[id].max} > ${lim}`)
  }
  console.log(falhas.length ? `ORÇAMENTO ESTOURADO:\n  ${falhas.join('\n  ')}` : 'orçamento de navegador: ok')
  fim(); process.exit(falhas.length ? 1 : 0)
}
fim(); process.exit(0)
