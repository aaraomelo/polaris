import { describe, expect, it } from 'vitest'
import { urlSegura } from '../src/render/url'

/** Como o parser de URL do navegador enxerga o valor: apara só C0/espaço nas pontas e remove tab/CR/LF em qualquer lugar. */
const comoNavegador = (s: string) => s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '')
const esquema = (s: string) => /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(comoNavegador(s))?.[1]?.toLowerCase()
const OK = new Set(['http', 'https', 'mailto', 'tel'])

// espaços e caracteres de formato que o trim() do JS remove (ou que parecem inofensivos) e o navegador NÃO remove
const UNICODE = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿', '​', '‌', '‍', '᠎', '\u0085', '­']
// controles e espaço ASCII que o navegador apara/ignora
const ASCII = ['\u0000', '\u0001', '\t', '\n', '\u000b', '\u000c', '\r', '\u001f', ' ']

describe('urlSegura: o valor devolvido nunca é uma URL executável para o navegador', () => {
  it('REGRESSÃO: o trim() do JS removia NBSP/U+2028/BOM e transformava uma URL relativa inofensiva em javascript:', () => {
    for (const c of UNICODE) {
      const r = urlSegura(`${c}javascript:alert(1)`)
      if (r !== undefined) {
        expect(r, JSON.stringify(c)).toBe(`${c}javascript:alert(1)`) // devolvido SEM alterar: o navegador a trata como relativa
        expect(esquema(r), JSON.stringify(c)).toBeUndefined() // e de fato não tem esquema para o navegador
      }
    }
  })

  it('para qualquer prefixo, sufixo ou separador (ASCII e Unicode), o resultado não tem esquema perigoso na visão do navegador', () => {
    const perigosos = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:x', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'blob:https://x/y']
    for (const alvo of perigosos) for (const c of [...UNICODE, ...ASCII]) {
      const meio = Math.floor(alvo.indexOf(':') / 2)
      for (const entrada of [c + alvo, alvo + c, c + c + alvo, ASCII[0] + c + alvo, alvo.slice(0, meio) + c + alvo.slice(meio), c + ' ' + alvo]) {
        const r = urlSegura(entrada)
        if (r === undefined) continue
        const e = esquema(r)
        expect(e === undefined || OK.has(e), `${JSON.stringify(entrada)} → ${JSON.stringify(r)} (esquema: ${e})`).toBe(true)
      }
    }
  })

  it('o que passa volta com a mesma semântica: só as pontas ASCII são aparadas, o resto é intocado', () => {
    expect(urlSegura('  /a b?c=1&d=2#e  ')).toBe('/a b?c=1&d=2#e')
    expect(urlSegura('\u0001\u0000 https://exemplo.com/x\n')).toBe('https://exemplo.com/x')
    expect(urlSegura(' /relativa')).toBe(' /relativa') // NBSP não é aparado: o navegador também não o apara
    expect(urlSegura('/ç日😀')).toBe('/ç日😀')
    expect(urlSegura('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(urlSegura('tel:+5511')).toBe('tel:+5511')
  })

  it('esquemas perigosos e entradas inválidas continuam recusados', () => {
    for (const u of ['javascript:alert(1)', ' javascript:x', 'java\tscript:x', 'java\nscript:x', 'JAVASCRIPT:x', 'vbscript:x', 'data:text/html,x', 'file:///etc', '\u0001javascript:x', '', '   ', '\u0000', 5, null, undefined, {}, ['x']]) {
      expect(urlSegura(u as string), JSON.stringify(u) ?? 'undefined').toBeUndefined()
    }
  })

  it('fuzz: nunca devolve algo que o navegador leia como esquema fora da lista', () => {
    let s = 3
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const pecas = ['javascript', 'JAVASCRIPT', 'java', 'script', ':', '/', '//', 'x', 'https', 'http', 'data', 'vbscript', '\t', '\n', ' ', ...UNICODE, ...ASCII, '%6a', '&#106;', '\\']
    for (let i = 0; i < 20000; i++) {
      const entrada = Array.from({ length: 1 + Math.floor(rnd() * 7) }, () => pecas[Math.floor(rnd() * pecas.length)]).join('')
      const r = urlSegura(entrada)
      if (r === undefined) continue
      const e = esquema(r)
      expect(e === undefined || OK.has(e), `${JSON.stringify(entrada)} → ${JSON.stringify(r)}`).toBe(true)
    }
  })
})
