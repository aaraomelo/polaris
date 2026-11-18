// A PORTA da identidade: o que o gateway precisa de quem sabe QUEM É o usuário (o diretório de usuários da plataforma). O gateway não guarda senha nem decide credencial:
// pergunta, e só então emite a sessão (o JWT, que vira o cookie `polaris_sessao`). Quem implementa fica em `apps/polaris` (packs/identidade + a chave de assinatura).
export type UsuarioId = { id: string; tenantId: string; email: string; nome: string; papeis: string[] }
export type PortaIdentidade = {
  entra(a: { tenantId: string; email: string; senha: string }): Promise<{ ok: true; usuario: UsuarioId } | { ok: false; motivo: 'credenciais' } | { ok: false; motivo: 'bloqueado'; ate: Date }>
  pedeRedefinicao(a: { tenantId: string; email: string }): Promise<{ token: string; usuario: UsuarioId } | null>
  redefine(a: { tenantId: string; token: string; senha: string }): Promise<{ ok: true; usuario: UsuarioId } | { ok: false; motivo: 'token_invalido' } | { ok: false; motivo: 'senha_fraca'; erros?: string[] }>
  /** o JWT da sessão (assinado só por quem tem a chave privada) */
  emite(usuario: UsuarioId): Promise<string>
  /** manda (ou enfileira) um e-mail; falha aqui nunca vaza para o visitante */
  enviaEmail(m: { tenantId: string; para: string; assunto: string; corpo: string }): Promise<void>
}
