// MÁSCARAS de digitação. Símbolos: 0 dígito (obrigatório), 9 dígito (opcional), A letra, a letra ou dígito, * qualquer caractere; o resto é literal (\x escapa um símbolo).
// A mesma função serve a quem digita (aplica a cada tecla), a quem cola (ignora o que não cabe) e ao servidor (recupera o valor sem literais).
// Com uma LISTA de padrões vale o primeiro em que tudo o que foi digitado cabe (telefone de 10 ou 11 dígitos troca sozinho ao digitar o 11º).

export type OpcoesMascara = { padrao: string | readonly string[]; substituto?: string; mostraLiterais?: boolean; enviaComLiterais?: boolean; maiusculas?: boolean }
export type ResultadoMascara = { /** o texto como aparece no campo */ formatado: string; /** só o que foi digitado nas posições (sem literais) */ bruto: string; /** todas as posições obrigatórias foram preenchidas */ completo: boolean; /** o padrão que valeu */ padrao: string; /** sobrou entrada que não coube (mais caracteres do que posições) */ estouro: boolean; /** quantos caracteres (letras ou dígitos) foram descartados por não caberem na posição */ perdidos: number }

type Token = { lit: string } | { slot: '0' | '9' | 'A' | 'a' | '*' }
const SIMBOLOS = '09Aa*'
const LIMITE_ENTRADA = 4096
const cache = new Map<string, Token[]>()

export function tokeniza(padrao: string): Token[] {
  const c = cache.get(padrao); if (c) return c
  const t: Token[] = []
  for (let i = 0; i < padrao.length; i++) {
    const ch = padrao[i]!
    if (ch === '\\') { i++; if (i < padrao.length) t.push({ lit: padrao[i]! }); continue }
    t.push(SIMBOLOS.includes(ch) ? { slot: ch as '0' } : { lit: ch })
  }
  if (cache.size > 500) cache.clear()
  cache.set(padrao, t); return t
}

const ehDigito = (c: string) => c >= '0' && c <= '9'
const ehLetra = (c: string) => /^\p{L}$/u.test(c)
const aceita = (slot: string, c: string) => slot === '0' || slot === '9' ? ehDigito(c) : slot === 'A' ? ehLetra(c) : slot === 'a' ? ehDigito(c) || ehLetra(c) : c.length > 0

function aplicaUm(padrao: string, entrada: string, maiusculas: boolean): ResultadoMascara {
  const tokens = tokeniza(padrao)
  let i = 0, formatado = '', pend = '', bruto = '', estouro = false, perdidos = 0
  const limite = entrada.length > LIMITE_ENTRADA ? entrada.slice(0, LIMITE_ENTRADA) : entrada
  for (const ch0 of limite) {
    const ch = maiusculas ? ch0.toUpperCase() : ch0
    let consumido = false
    while (!consumido) {
      while (i < tokens.length && 'lit' in tokens[i]!) { const l = (tokens[i] as { lit: string }).lit; i++; if (l === ch && !consumido) { formatado += pend + l; pend = ''; consumido = true; break } pend += l }
      if (consumido) break
      if (i >= tokens.length) { if (/[\p{L}\p{N}]/u.test(ch)) { estouro = true; perdidos++ } consumido = true; break }
      const s = (tokens[i] as { slot: string }).slot
      if (aceita(s, ch)) { formatado += pend + ch; pend = ''; bruto += ch; i++ } else if (/[\p{L}\p{N}]/u.test(ch)) perdidos++
      consumido = true // o que não cabe na posição é descartado
    }
  }
  const slots = tokens.filter((t) => 'slot' in t) as Array<{ slot: string }>
  let ultimaObrigatoria = -1; slots.forEach((s, n) => { if (s.slot !== '9') ultimaObrigatoria = n })
  return { formatado, bruto, completo: bruto.length >= ultimaObrigatoria + 1, padrao, estouro, perdidos }
}

export function aplicaMascara(entrada: string, o: OpcoesMascara): ResultadoMascara {
  const padroes = typeof o.padrao === 'string' ? [o.padrao] : o.padrao
  // com vários padrões vale o que PERDE menos do que foi digitado (o primeiro, no empate): o 11º dígito troca o telefone de 10 para 11; ABC1D23 não cabe em AAA-0000 mas cabe em AAA0A00
  let res = aplicaUm(padroes[0]!, entrada, !!o.maiusculas)
  for (const p of padroes.slice(1)) { const r = aplicaUm(p, entrada, !!o.maiusculas); if (r.perdidos < res.perdidos) res = r }
  // sem literais enquanto digita (mostraLiterais: false): o campo mostra só o digitado até a máscara completar
  return o.mostraLiterais === false && !res.completo ? { ...res, formatado: res.bruto } : res
}

/** o valor que o formulário guarda e envia: sem os literais (padrão) ou com eles (`enviaComLiterais`) */
export function valorDaMascara(entrada: string, o: OpcoesMascara): string {
  const r = aplicaMascara(entrada, { ...o, mostraLiterais: true })
  return o.enviaComLiterais ? r.formatado : r.bruto
}

/** o campo mostra o valor guardado com a máscara (sempre com literais para mostrar completo); `substituto` preenche as posições vazias para exibição fixa */
export function exibeComMascara(guardado: string, o: OpcoesMascara): string {
  const r = aplicaMascara(guardado, { ...o, mostraLiterais: true })
  if (!o.substituto) return r.formatado
  // o digitado onde há, o substituto onde falta; os literais nos seus lugares
  let b = 0, out = ''
  for (const t of tokeniza(r.padrao)) out += 'lit' in t ? t.lit : b < r.bruto.length ? r.bruto[b++]! : o.substituto
  return out
}
