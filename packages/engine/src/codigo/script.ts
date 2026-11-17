import { PADROES_CODIGO, type PedidoCodigo, type ResultadoCodigo } from './sandbox'

// O script que roda DENTRO do interpretador isolado. Comum a todas as implementações de Sandbox, para a
// semântica ser idêntica (e o resultado, determinístico: o mesmo código dá a mesma saída no servidor e no cliente).
//
// Convenção do autor:  function render(props, ctx) { return { tag: 'p', children: ['olá'] } }
// Sem rede, sem DOM, sem relógio real, sem aleatoriedade real.

const fnv1a = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } return h >>> 0 }

export function montaScript(p: PedidoCodigo): { ok: true; script: string } | { ok: false; tipo: 'entrada'; erro: string } {
  let propsJson: string, ctxJson: string
  try {
    propsJson = JSON.stringify(p.props ?? null) ?? 'null'
    ctxJson = JSON.stringify(p.contexto) ?? 'null'
  } catch { return { ok: false, tipo: 'entrada', erro: 'props não serializáveis em JSON' } }
  if (propsJson.length > PADROES_CODIGO.entradaMaxBytes) return { ok: false, tipo: 'entrada', erro: `props com mais de ${PADROES_CODIGO.entradaMaxBytes} bytes` }
  const agora = Date.parse(p.contexto.agora)
  const semente = fnv1a(p.fonte + propsJson)
  const max = p.saidaMaxBytes ?? PADROES_CODIGO.saidaMaxBytes
  const prelude = `
var __agora = ${Number.isFinite(agora) ? agora : 0}, __D = Date, __P = __D.prototype;
// Fuso fixo em UTC: os getters/setters/parse "locais" do JS dependem do fuso do host, e servidor e cliente teriam saídas diferentes.
["FullYear","Month","Date","Day","Hours","Minutes","Seconds","Milliseconds"].forEach(function(n){ __P["get"+n] = __P["getUTC"+n]; if (n !== "Day") __P["set"+n] = __P["setUTC"+n] });
__P.getTimezoneOffset = function(){ return 0 };
var __ok = function(d){ return !isNaN(d.getTime()) };
__P.toString = function(){ return __ok(this) ? this.toUTCString() : "Invalid Date" };
__P.toDateString = function(){ return __ok(this) ? this.toISOString().slice(0,10) : "Invalid Date" };
__P.toTimeString = function(){ return __ok(this) ? this.toISOString().slice(11,19) + " UTC" : "Invalid Date" };
__P.toLocaleString = function(){ return __ok(this) ? this.toISOString().replace("T"," ").slice(0,19) : "Invalid Date" };
__P.toLocaleDateString = function(){ return __ok(this) ? this.toISOString().slice(0,10) : "Invalid Date" };
__P.toLocaleTimeString = function(){ return __ok(this) ? this.toISOString().slice(11,19) : "Invalid Date" };
var __SEMTZ = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?$/;
var __conv = function(a){ return typeof a === "string" && __SEMTZ.test(a) ? a + "Z" : a };
function __FD(a,b,c,d,e,f,g){ if (!(this instanceof __FD)) return new __D(__agora).toString(); var n = arguments.length; return n === 0 ? new __D(__agora) : n === 1 ? new __D(__conv(a)) : new __D(__D.UTC(a,b,c === undefined ? 1 : c,d || 0,e || 0,f || 0,g || 0)) }
__FD.prototype = __P; __FD.now = function(){ return __agora }; __FD.parse = function(s){ return __D.parse(__conv(s)) }; __FD.UTC = __D.UTC; Date = __FD;
var __s = ${semente} | 0;
Math.random = function(){ __s = (__s + 0x6D2B79F5) | 0; var t = Math.imul(__s ^ (__s >>> 15), 1 | __s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
var __logs = []; var __reg = function(){ if (__logs.length < 20) { var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i])); __logs.push(a.join(" ").slice(0, 200)) } };
console = { log: __reg, info: __reg, warn: __reg, error: __reg, debug: __reg };`
  const script = `(function(){${prelude}
var __fn = (function(){
${p.fonte}
;return typeof render === "function" ? render : undefined })();
if (typeof __fn !== "function") throw new Error("O código precisa definir function render(props, ctx)");
var __saida = JSON.stringify(__fn(JSON.parse(${JSON.stringify(propsJson)}), JSON.parse(${JSON.stringify(ctxJson)})));
if (typeof __saida !== "string") throw new Error("render deve devolver um valor serializável em JSON");
if (__saida.length > ${max}) throw new Error("SAIDA_GRANDE");
return JSON.stringify({ s: __saida, l: __logs });
})()`
  return { ok: true, script }
}

/** Traduz o erro do interpretador (nome + mensagem) para um tipo de falha estável. */
export function classificaErro(nome: string, mensagem: string): { tipo: Extract<ResultadoCodigo, { ok: false }>['tipo']; erro: string } {
  const m = mensagem.slice(0, 300)
  if (/interrupted/i.test(m)) return { tipo: 'tempo', erro: 'o código excedeu o tempo permitido' }
  if (/out of memory/i.test(m)) return { tipo: 'memoria', erro: 'o código excedeu a memória permitida' }
  if (/stack overflow/i.test(m)) return { tipo: 'execucao', erro: 'estouro de pilha (recursão profunda demais)' }
  if (m.includes('SAIDA_GRANDE')) return { tipo: 'saida', erro: 'a saída do código é grande demais' }
  if (nome === 'SyntaxError') return { tipo: 'sintaxe', erro: m }
  return { tipo: 'execucao', erro: m }
}

/** Interpreta a string devolvida pelo script: valida o envelope { s, l } e os tamanhos. */
export function interpretaSaida(bruta: string, ms: number): ResultadoCodigo {
  try {
    const o = JSON.parse(bruta) as { s?: unknown; l?: unknown }
    if (typeof o.s !== 'string') return { ok: false, tipo: 'saida', erro: 'saída inválida', ms }
    const logs = Array.isArray(o.l) ? o.l.filter((x): x is string => typeof x === 'string').slice(0, 20) : []
    return { ok: true, saida: o.s, logs, ms }
  } catch { return { ok: false, tipo: 'saida', erro: 'saída inválida', ms } }
}
