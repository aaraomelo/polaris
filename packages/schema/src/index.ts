import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { traduzTodos, type Erro } from './mensagens'
import no from '../schemas/no.schema.json'
import comum from '../schemas/comum.schema.json'
import pagina from '../schemas/kinds/pagina.schema.json'
import bloco from '../schemas/kinds/bloco.schema.json'
import tema from '../schemas/kinds/tema.schema.json'
import dados from '../schemas/kinds/dados.schema.json'
import servico from '../schemas/kinds/servico.schema.json'
import evento from '../schemas/kinds/evento.schema.json'
import kernel from '../schemas/kinds/kernel.schema.json'
import documento from '../schemas/kinds/documento.schema.json'
import tenant from '../schemas/kinds/tenant.schema.json'
import backend from '../schemas/kinds/backend.schema.json'
import migracao from '../schemas/migracao.schema.json'

export const KINDS = ['pagina', 'bloco', 'tema', 'dados', 'servico', 'evento', 'kernel', 'documento', 'tenant', 'backend'] as const
export type Kind = (typeof KINDS)[number]

export const SCHEMAS = { no, comum, migracao, pagina, bloco, tema, dados, servico, evento, kernel, documento, tenant, backend }

/** Major atual do schema de cada kind. Subir aqui exige uma migração (src/migracao.ts) e fixtures congeladas. */
export const ESQUEMA_ATUAL: Record<Kind, number> = {
  pagina: 1, bloco: 1, tema: 1, dados: 1, servico: 1, evento: 1, kernel: 1, documento: 1, tenant: 1, backend: 1,
}
export const ID_NO = 'polaris://no/v1'

export type No = {
  kind: Kind
  id: string
  versao: string
  esquema?: number
  estatuto?: 'rascunho' | 'publicado' | 'obsoleto'
  tenantId?: string | null
  segmento?: string
  meta?: Record<string, unknown>
  emit?: string[]
  spec: Record<string, unknown>
  filhos?: No[]
}

export function criaAjv(opcoes: { verbose?: boolean } = {}): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true, verbose: opcoes.verbose })
  addFormats(ajv)
  for (const s of Object.values(SCHEMAS)) ajv.addSchema(s)
  return ajv
}

export type Resultado = { ok: true; no: No } | { ok: false; erros: Erro[] }

/** Valida um nó contra o envelope e o schema do seu kind. Erros trazem o caminho JSON. */
export function criaValidador() {
  const ajv = criaAjv({ verbose: true })
  const v = ajv.getSchema(ID_NO)!
  return function valida(dado: unknown): Resultado {
    if (v(dado)) return { ok: true, no: dado as No }
    return { ok: false, erros: traduzTodos(v.errors ?? []) }
  }
}

export * from './registry'
export * from './migracao'
export * from './estrutura'
export * from './mensagens'
export * from './emissao'
export * from './evolucao'
