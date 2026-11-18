import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export { resolvePreco, operacoesCatalogo, type Candidato, type Preco } from './catalogo'
export { adiciona, compara, custoMedio, divideConta, multiplica, normaliza, paraCentavos4, percentual, proporcional, soma, subtrai } from './dinheiro'
export { ALIAS_RESERVADOS, planoDeCadastro, segmentosDisponiveis, validaAlias, type Landing, type PedidoCadastro, type Plano, type SegmentoPublico, type Semente } from './onboarding'
export { criaSemeador, provisiona, type Diretorio, type Portas as PortasCadastro, type Resultado as ResultadoCadastro, type Status as StatusTenant } from './provisiona'
export { rotasCadastro, type Limite, type OpcoesCadastro } from './cadastro-http'
export { criaPreview, criaReleases, type Producao, type Release } from './releases'
export { KINDS_DO_TENANT, criaArmazemDeNos, type KindDoTenant, type Limites as LimitesOverrides, type ResultadoSalvar, type VersaoNo } from './overrides'
export { rotasStudio, sessaoDeToken, type OpcoesStudio, type Sessao } from './studio-http'
export { criaGestorDominios, criaResolvedorTenant, mudaStatusTenant, normalizaHost, validaDominio, type Dns, type InfoTenant, type OpcoesResolvedor, type Reivindicacao } from './dominios'
export { DDL_DIRETORIO, diretorioSql } from './diretorio'
export { DDL_IDENTIDADE, criaIdentidade, normalizaEmail, type Identidade, type OpcoesIdentidade, type Usuario } from './identidade'
export { CUSTO_PADRAO, confereSenha, hashSenha, politicaDeSenha, type CustoSenha } from './senha'
export { registroDaPlataforma } from './plataforma'
export { criaAlimentos } from './alimentos'
export { criaServicos } from './servicos'
export { criaEstoque, portaEstoque, type ClienteEstoque } from './estoque'
export { criaPagamentos, portaPagamento, provedorInterno, type ClientePagamentos, type Cobranca, type OpcoesPagamentos, type Provedor, type ResultadoProvedor } from './pagamentos'
export { criaVendas, type Cotacao, type ItemSaga, type OpcoesVendas, type PedidoSaga, type Portas, type Resultado } from './vendas'

/** Os nós (JSON) de um pack, prontos para `registry.registra`. */
export function nosDoPack(pack: 'catalogo' | 'vendas' | 'pagamentos' | 'estoque' | 'servicos' | 'alimentos' | 'studio' | 'segmentos'): unknown[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'nos', pack)
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown; return Array.isArray(j) ? j : [j] })
}
