import type { StatusDado } from '../dados/carrega'
import type { Escopo } from '../expr/index'
import type { Programa } from './programa'

/** Estado reativo da página: estado local, valor/status/erro de cada variável de dados. */
export type Store = {
  estado: Record<string, unknown>
  dados: Record<string, unknown>
  status: Record<string, StatusDado>
  erros: Record<string, string>
}

export type AcaoStore =
  | { t: 'estado'; nome: string; valor: unknown }
  | { t: 'carregando'; nome: string }
  | { t: 'dado'; nome: string; valor: unknown }
  | { t: 'erro'; nome: string; erro: string }

export function reduz(s: Store, a: AcaoStore): Store {
  switch (a.t) {
    case 'estado': return { ...s, estado: { ...s.estado, [a.nome]: a.valor } }
    case 'carregando': return { ...s, status: { ...s.status, [a.nome]: 'carregando' } }
    case 'dado': {
      const { [a.nome]: _, ...erros } = s.erros
      return { ...s, dados: { ...s.dados, [a.nome]: a.valor }, status: { ...s.status, [a.nome]: 'ok' }, erros }
    }
    case 'erro': return { ...s, status: { ...s.status, [a.nome]: 'erro' }, erros: { ...s.erros, [a.nome]: a.erro } }
  }
}

export type SementeStore = { estado?: Record<string, unknown>; dados?: Record<string, unknown>; status?: Record<string, StatusDado>; erros?: Record<string, string> }

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Store inicial: valores iniciais do schema, sobrepostos pelo que veio do servidor. Só nomes declarados entram. */
export function iniciaStore(programa: Programa, semente: SementeStore = {}): Store {
  const estado: Record<string, unknown> = {}
  for (const [nome, d] of Object.entries(programa.pagina.estado)) {
    estado[nome] = semente.estado && tem(semente.estado, nome) ? semente.estado[nome] : d.inicial
  }
  const dados: Record<string, unknown> = {}
  const status: Record<string, StatusDado> = {}
  const erros: Record<string, string> = {}
  for (const nome of Object.keys(programa.pagina.dados)) {
    if (semente.dados && tem(semente.dados, nome)) dados[nome] = semente.dados[nome]
    status[nome] = semente.status && tem(semente.status, nome) ? semente.status[nome]! : 'ok'
    if (semente.erros && tem(semente.erros, nome)) erros[nome] = semente.erros[nome]!
  }
  return { estado, dados, status, erros }
}

/** Escopo vindo do store: estado, status, erros e SÓ os dados declarados (hasOwn: 'toString' não puxa Object.prototype). */
export function escopoDaStore(programa: Programa, store: Store, base: Escopo = {}): Escopo {
  const escopo: Escopo = { ...base, estado: store.estado, status: store.status, erros: store.erros }
  for (const nome of Object.keys(programa.pagina.dados)) {
    if (tem(store.dados, nome)) escopo[nome] = store.dados[nome]
    else delete escopo[nome]
  }
  return escopo
}
