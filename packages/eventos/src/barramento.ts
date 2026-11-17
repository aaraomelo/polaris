import type { Assinatura, Barramento, Envelope } from './tipos'

const major = (v: string) => Number(v.split('.')[0])

export type Morta = { consumidor: string; envelope: Envelope; tentativas: number; erro: string }
export type BarramentoMemoria = Barramento & {
  /** espera a fila de entregas esvaziar (o barramento ACEITA o evento e entrega depois, como um broker de verdade) */
  aguarda(): Promise<void>
  /** tudo o que passou pelo barramento, em ordem de chegada */
  log(): Envelope[]
  /** entregas que esgotaram as tentativas */
  mortas(): Morta[]
  /** reentrega o que está no log (filtrável) a UM consumidor (ou a todos) */
  replay(filtro?: { tipo?: string; consumidor?: string; depoisDe?: string }): Promise<number>
}

/**
 * Barramento em memória (dev/teste e contrato de referência): entrega ao MENOS UMA VEZ, com tentativas e fila de mortas.
 * Quem assina recebe só os tipos pedidos e só os MAJORS que declarou entender; o resto é ignorado (e não conta como falha).
 */
export function criaBarramentoMemoria(opcoes: { maxTentativas?: number } = {}): BarramentoMemoria {
  const max = opcoes.maxTentativas ?? 3
  const assinaturas = new Set<Assinatura>()
  const log: Envelope[] = [], mortas: Morta[] = []
  let fila: Promise<void> = Promise.resolve() // entregas em série, na ordem de chegada
  const quer = (a: Assinatura, e: Envelope) => a.tipos.includes(e.tipo) && (!a.versoes || a.versoes.includes(major(e.versao)))
  async function entrega(a: Assinatura, e: Envelope) {
    let erro = ''
    for (let i = 1; i <= max; i++) {
      try { await a.manipula(e); return } catch (err) { erro = err instanceof Error ? err.message : String(err) }
    }
    mortas.push({ consumidor: a.consumidor, envelope: e, tentativas: max, erro })
  }
  return {
    async publica(env) {
      log.push(env)
      const alvos = [...assinaturas].filter((a) => quer(a, env))
      fila = fila.then(async () => { for (const a of alvos) await entrega(a, env) }) // aceita e devolve: a entrega acontece depois
    },
    aguarda: () => fila,
    assina(a) { assinaturas.add(a); return () => { assinaturas.delete(a) } },
    log: () => [...log], mortas: () => [...mortas],
    async replay(f = {}) {
      let n = 0
      for (const e of [...log]) {
        if (f.tipo && e.tipo !== f.tipo) continue
        if (f.depoisDe && e.ocorridoEm <= f.depoisDe) continue
        for (const a of [...assinaturas]) if ((!f.consumidor || a.consumidor === f.consumidor) && quer(a, e)) { n++; fila = fila.then(() => entrega(a, e)) }
      }
      await fila
      return n
    },
  }
}
