export class ErroApi extends Error {
  constructor(readonly status: number, readonly codigo: string, mensagem: string, readonly detalhes?: unknown) { super(mensagem); this.name = 'ErroApi' }
}
export const corpoErro = (e: ErroApi) => ({ erro: { codigo: e.codigo, mensagem: e.message, ...(e.detalhes !== undefined ? { detalhes: e.detalhes } : {}) } })

/** erros do Postgres que são do CLIENTE (não bug nosso): código SQLSTATE → resposta */
export function erroDoBanco(e: unknown): ErroApi | null {
  const code = (e as { code?: string } | null)?.code
  switch (code) {
    case '23505': return new ErroApi(409, 'duplicado', 'já existe um registro com esse valor único')
    case '23503': return new ErroApi(409, 'referencia_invalida', 'o registro referenciado não existe (ou ainda é referenciado por outro)')
    case '23502': return new ErroApi(400, 'campo_obrigatorio', 'falta um campo obrigatório')
    case '22P02': case '22003': case '22007': case '22008': return new ErroApi(400, 'valor_invalido', 'valor com formato inválido')
    case '42501': return new ErroApi(403, 'proibido', 'operação não permitida para este tenant')
    default: return null
  }
}
