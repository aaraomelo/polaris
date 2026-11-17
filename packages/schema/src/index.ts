import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
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

export const KINDS = ['pagina', 'bloco', 'tema', 'dados', 'servico', 'evento', 'kernel', 'documento', 'tenant', 'backend'] as const
export type Kind = (typeof KINDS)[number]

export const SCHEMAS = { no, comum, pagina, bloco, tema, dados, servico, evento, kernel, documento, tenant, backend }
export const ID_NO = 'polaris://no/v1'

export type No = {
  kind: Kind
  id: string
  versao: string
  estatuto?: 'rascunho' | 'publicado' | 'obsoleto'
  tenantId?: string | null
  meta?: Record<string, unknown>
  emit?: string[]
  spec: Record<string, unknown>
  filhos?: No[]
}

export function criaAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true })
  addFormats(ajv)
  for (const s of Object.values(SCHEMAS)) ajv.addSchema(s)
  return ajv
}

export type Erro = { caminho: string; mensagem: string; regra: string }
export type Resultado = { ok: true; no: No } | { ok: false; erros: Erro[] }

/** Valida um nó contra o envelope e o schema do seu kind. Erros trazem o caminho JSON. */
export function criaValidador() {
  const ajv = criaAjv()
  const v = ajv.getSchema(ID_NO)!
  return function valida(dado: unknown): Resultado {
    if (v(dado)) return { ok: true, no: dado as No }
    const erros = (v.errors ?? [])
      .filter((e) => e.keyword !== 'if')
      .map((e) => ({
        caminho: e.instancePath || '/',
        mensagem: e.message ?? 'inválido',
        regra: e.keyword,
      }))
    return { ok: false, erros }
  }
}
