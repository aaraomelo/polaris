import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KINDS, Registry, alvosDe, confere, criaValidador, emite, type Erro, type No } from '../src/index'

// ---------------------------------------------------------------------------
// Suíte de conformidade: casos de entrada + golden files (saída esperada, versionada).
//   emissoes/  → cada exemplo válido × cada alvo suportado pelo kind
//   erros/     → cada exemplo inválido → lista de erros traduzidos (caminho, regra, mensagem, dica)
//   estrutura/ → cada caso contra o registry base → erros de confere() (refs, slots, ids, props, ciclo, limites)
// Para aceitar uma mudança de propósito:  ATUALIZAR_GOLDEN=1 pnpm conformidade   e revise o git diff.
// ---------------------------------------------------------------------------

const raiz = __dirname
const ATUALIZAR = process.env.ATUALIZAR_GOLDEN === '1'
const lista = (...p: string[]) => readdirSync(join(raiz, ...p)).filter((f) => f.endsWith('.json')).sort()
const le = (...p: string[]) => JSON.parse(readFileSync(join(raiz, ...p), 'utf8'))
const base = (f: string) => f.replace(/\.json$/, '')
const limpa = (es: Erro[]) => es.map(({ caminho, regra, mensagem, dica }) => ({ caminho, regra, mensagem, ...(dica ? { dica } : {}) }))

/** Esperado de um golden, ou o que foi gravado agora no modo de atualização. */
const esperado = (esquecidos: Set<string>, subdir: string, nome: string, obtido: string): string => {
  const caminho = join(raiz, 'golden', subdir, nome)
  esquecidos.delete(`${subdir}/${nome}`)
  if (ATUALIZAR) {
    mkdirSync(join(raiz, 'golden', subdir), { recursive: true })
    writeFileSync(caminho, obtido)
    return obtido
  }
  if (!existsSync(caminho)) throw new Error(`golden ausente: golden/${subdir}/${nome} — rode ATUALIZAR_GOLDEN=1 pnpm conformidade e revise`)
  return readFileSync(caminho, 'utf8')
}

const goldenExistentes = () =>
  new Set(['emissoes', 'erros', 'estrutura'].flatMap((d) => (existsSync(join(raiz, 'golden', d)) ? readdirSync(join(raiz, 'golden', d)).map((f) => `${d}/${f}`) : [])))
const esquecidos = goldenExistentes()
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
const valida = criaValidador()

describe('conformidade: emissões dos exemplos válidos', () => {
  for (const f of lista('exemplos', 'validos')) {
    const no = le('exemplos', 'validos', f) as No
    for (const alvo of alvosDe(no.kind)) {
      it(`${base(f)} → ${alvo}`, () => {
        expect(valida(no).ok).toBe(true)
        expect(emite(no, alvo)).toBe(esperado(esquecidos, 'emissoes', `${base(f)}.${alvo}`, emite(no, alvo)))
      })
    }
  }
})

describe('conformidade: erros dos exemplos inválidos', () => {
  for (const f of lista('exemplos', 'invalidos')) {
    it(base(f), () => {
      const r = valida(le('exemplos', 'invalidos', f))
      expect(r.ok).toBe(false)
      const obtido = json(r.ok ? [] : limpa(r.erros))
      expect(obtido).toBe(esperado(esquecidos, 'erros', f, obtido))
    })
  }
})

describe('conformidade: validação estrutural contra o registry base', () => {
  const monta = (caso: No) => {
    const reg = new Registry()
    for (const f of lista('conformidade', 'base')) reg.registra(le('conformidade', 'base', f))
    return { reg, no: reg.registra(structuredClone(caso)) as No }
  }
  for (const f of lista('conformidade', 'estrutura')) {
    it(base(f), () => {
      const { reg, no } = monta(le('conformidade', 'estrutura', f))
      const obtido = json(limpa(confere(reg, no)))
      expect(obtido).toBe(esperado(esquecidos, 'estrutura', f, obtido))
    })
  }
})

describe('conformidade: requisitos da própria suíte', () => {
  const kindsDe = (...p: string[]) => new Set(lista(...p).map((f) => le(...p, f).kind as string))

  it('todo kind tem exemplo válido (com emissão em golden) e exemplo inválido', () => {
    const validos = kindsDe('exemplos', 'validos')
    const invalidos = kindsDe('exemplos', 'invalidos')
    for (const k of KINDS) {
      expect(validos.has(k), `sem exemplo válido de ${k}`).toBe(true)
      expect(invalidos.has(k), `sem exemplo inválido de ${k}`).toBe(true)
    }
  })

  it('os erros de cada exemplo inválido apontam a regra esperada no nome do arquivo (sanidade do golden)', () => {
    // Um golden vazio ou sem erros seria um falso verde.
    for (const f of lista('exemplos', 'invalidos')) {
      const g = JSON.parse(readFileSync(join(raiz, 'golden', 'erros', f), 'utf8'))
      expect(g.length, f).toBeGreaterThan(0)
    }
  })

  it('o caso estrutural "pagina-ok" não tem erros e os demais têm', () => {
    for (const f of lista('conformidade', 'estrutura')) {
      const g = JSON.parse(readFileSync(join(raiz, 'golden', 'estrutura', f), 'utf8'))
      if (f === 'pagina-ok.json') expect(g).toEqual([])
      else expect(g.length, f).toBeGreaterThan(0)
    }
  })

  it('não há golden obsoleto (sem caso correspondente)', () => {
    if (ATUALIZAR) {
      // limpa o que ficou sem caso
      for (const g of esquecidos) expect(existsSync(join(raiz, 'golden', g))).toBe(true)
      return
    }
    expect([...esquecidos].sort(), 'remova os golden sem caso').toEqual([])
  })
})
