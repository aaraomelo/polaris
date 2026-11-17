import { buildMongoQueryMatcher, createMongoAbility } from '@casl/ability'
import * as u from '@ucast/mongo2js'
import { paraCasl } from './papeis'
import type { Regra } from './tipos'

// O matcher do CASL com os operadores lógicos que a nossa linguagem de condição tem. O CASL padrão não os conhece: `{ $or: [...] }` simplesmente nunca casa.
const mongo = u as unknown as Record<string, never>
const conditionsMatcher = buildMongoQueryMatcher(
  { $and: mongo.$and, $or: mongo.$or, $nor: mongo.$nor, $not: mongo.$not },
  { and: mongo.and, or: mongo.or, nor: mongo.nor, not: mongo.not },
)

/**
 * `Ability` do CASL com MongoQuery completo ($or/$and/$nor/$not, $all/$size/$elemMatch…) a partir das regras. Serve ao FRONT (esconder botões, validar
 * formulário) e como ORÁCULO dos testes; o servidor decide com `permite`/`resolve`, que concordam com ele (testado).
 * As condições devem ter `$usuario`/`$tenant` já substituídos (`substitui`).
 */
export const criaAbility = (regras: Regra[]) => createMongoAbility(paraCasl(regras) as never, { conditionsMatcher })
