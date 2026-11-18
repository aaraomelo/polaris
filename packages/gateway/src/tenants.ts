// O contrato entre o gateway e o diretório de tenants da plataforma. O gateway não sabe de onde vem (SQL, cache, outro serviço): só do que precisa decidir.
export type StatusTenant = 'provisionando' | 'ativo' | 'falhou' | 'suspenso' | 'cancelado'
export type InfoTenant = { id: string; status: StatusTenant; /** serviços habilitados para o tenant (os `servico` dos packs) */ modulos: string[]; /** a release de PRODUÇÃO (publicada) do tenant; `null`/ausente = só core/segmento */ release?: number | null }
export type ResolvedorTenant = {
  /** o tenant dono deste host (subdomínio da plataforma ou domínio próprio VERIFICADO), ou null se o host não é de tenant nenhum */
  porHost(host: string): Promise<InfoTenant | null>
  porId(id: string): Promise<InfoTenant | null>
}

/** Onde o gateway busca o registro (páginas, dados, temas…) de um tenant: o core/segmento mais a release de PRODUÇÃO dele. Imutável por release: o provedor pode guardar em cache. */
export type RegistrosDeTenant = {
  producao(tenantId: string, release: number | null): Promise<import('@polaris/schema').Registry>
}
/** Pré-visualização de uma release ainda não promovida, por um link assinado e de curta duração (sem login): quem tem o token vê, só aquele tenant, só aquela release. */
export type PreviewDeRelease = {
  verifica(token: string): { tenantId: string; release: number } | null
  registro(tenantId: string, release: number): Promise<import('@polaris/schema').Registry | null>
}
