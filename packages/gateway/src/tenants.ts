// O contrato entre o gateway e o diretório de tenants da plataforma. O gateway não sabe de onde vem (SQL, cache, outro serviço): só do que precisa decidir.
export type StatusTenant = 'provisionando' | 'ativo' | 'falhou' | 'suspenso' | 'cancelado'
export type InfoTenant = { id: string; status: StatusTenant; /** serviços habilitados para o tenant (os `servico` dos packs) */ modulos: string[] }
export type ResolvedorTenant = {
  /** o tenant dono deste host (subdomínio da plataforma ou domínio próprio VERIFICADO), ou null se o host não é de tenant nenhum */
  porHost(host: string): Promise<InfoTenant | null>
  porId(id: string): Promise<InfoTenant | null>
}
