// Executado em processo filho com TZ diferente: imprime o que o Date NATIVO do host e o sandbox produzem.
import { criaSandboxLocal } from '../../src/sandbox/local'

const sb = await criaSandboxLocal()
const fonte = `function render(){
  var d = new Date("2020-06-15T23:30:45.123Z"), s = new Date("2020-06-15T23:30:45"), p = new Date(2020, 5, 15, 23, 30, 45);
  return { h: d.getHours(), dia: d.getDate(), tz: d.getTimezoneOffset(), s: s.toISOString(), p: p.toISOString(), ts: d.toString(), tl: d.toLocaleString(), parse: Date.parse("2020-06-15T00:00:00") }
}`
const r = sb.executa({ fonte, props: {}, contexto: { agora: '2026-06-08T12:00:00.000Z' } })
const nativo = new Date('2020-06-15T23:30:45.123Z')
console.log(JSON.stringify({ host: { h: nativo.getHours(), tz: nativo.getTimezoneOffset(), s: new Date('2020-06-15T23:30:45').toISOString() }, sandbox: r.ok ? r.saida : r }))
