import { readFileSync, readdirSync } from 'node:fs'
const dir = process.argv[2]
const arq = readdirSync(dir).filter((f) => f.endsWith('.cpuprofile')).sort().pop()
const p = JSON.parse(readFileSync(`${dir}/${arq}`, 'utf8'))
const porId = new Map(p.nodes.map((n) => [n.id, n]))
const proprio = new Map()
p.samples.forEach((id, i) => { const n = porId.get(id); const dt = p.timeDeltas[i] / 1000; const k = `${n.callFrame.functionName || '(anônima)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`; proprio.set(k, (proprio.get(k) ?? 0) + dt) })
const total = [...proprio.values()].reduce((a, b) => a + b, 0)
const agrup = new Map()
for (const [k, ms] of proprio) { const lib = /react-dom/.test(k) ? 'react-dom' : /\/react\/|react\.(development|production)/.test(k) ? 'react' : /packages\/engine\/src/.test(k) ? 'nosso código' : /\(program\)|\(garbage|\(idle|\(root/.test(k) ? 'runtime (gc/idle)' : /node:internal|node_modules/.test(k) ? 'outras libs/node' : 'native/outros'; agrup.set(lib, (agrup.get(lib) ?? 0) + ms) }
console.log(`\nperfil: ${total.toFixed(0)} ms amostrados\n--- por origem`)
for (const [k, ms] of [...agrup].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${ms.toFixed(0).padStart(6)} ms  ${((ms / total) * 100).toFixed(1).padStart(5)}%`)
console.log('--- 18 funções com mais tempo próprio')
for (const [k, ms] of [...proprio].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${ms.toFixed(0).padStart(6)} ms ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${k.slice(0, 92)}`)
