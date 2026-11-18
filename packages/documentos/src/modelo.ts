// Modelo RESOLVIDO do documento: já sem bindings, sem `se`/`repetir`, em pontos (pt). É o que o layout consome. Vem do nó (`kind: documento`, em português) por `resolve.ts`.
export type Alinha = 'esquerda' | 'centro' | 'direita'
export type Peso = 'normal' | 'negrito'
export type Rgb = [number, number, number]
export type Estilo = { tamanho?: number; peso?: Peso; cor?: Rgb; alinhamento?: Alinha }
export type Celula = { principal: string; secundario?: string; alinhamento?: Alinha; peso?: Peso }
export type Bloco =
  | { tipo: 'espaco'; altura: number }
  | { tipo: 'barraSecao'; texto: string; variante: 'titulo' | 'secao' }
  | ({ tipo: 'paragrafo'; texto: string } & Estilo)
  | { tipo: 'campo'; rotulo: string; valor: string; estiloValor?: Estilo }
  | { tipo: 'colunas'; colunas: Array<{ flex: number; blocos: Bloco[] }>; espacamento: number }
  | { tipo: 'tabela'; colunas: Array<{ cabecalho: string; flex: number; alinhamento?: Alinha }>; linhas: Celula[][] }
  | { tipo: 'resumo'; linhas: Array<{ rotulo: string; valor: string; forte?: boolean }>; larguraFracao: number }
  | { tipo: 'assinaturas'; itens: Array<{ rotulo: string }> }
  | { tipo: 'imagem'; src: string; largura: number; altura: number; alinhamento?: Alinha; alt: string }

export type DocumentoResolvido = { tamanho: 'A4' | 'A5' | 'Letter'; paisagem: boolean; margemMm: { topo: number; direita: number; baixo: number; esquerda: number }; fonte: string; rodape?: string; dados: unknown; titulo: string; blocos: Bloco[] }

// primitivas de desenho posicionadas (pt, origem no topo-esquerdo, y para baixo). PDF e HTML consomem ISTO: a quebra de linha e a altura já foram decididas no layout, então as duas saídas coincidem.
export type OpTexto = { tipo: 'texto'; x: number; yTopo: number; texto: string; peso: Peso; tamanho: number; cor: Rgb; ascender: number; alturaLinha: number }
export type OpRet = { tipo: 'ret'; x: number; y: number; l: number; a: number; cor: Rgb }
export type OpLinha = { tipo: 'linha'; x1: number; y1: number; x2: number; y2: number; cor: Rgb; espessura: number }
export type OpImagem = { tipo: 'imagem'; x: number; y: number; l: number; a: number; src: string; alt: string }
export type Op = OpTexto | OpRet | OpLinha | OpImagem
export type Pagina = { largura: number; altura: number; ops: Op[] }
export type Layout = { paginas: Pagina[]; largura: number; altura: number; fonte: string; titulo: string }

export const INK: Rgb = [33, 33, 33], MUTED: Rgb = [120, 120, 120], BARRA_TITULO: Rgb = [201, 201, 201], BARRA_SECAO: Rgb = [233, 233, 233], LINHA_TOTAL: Rgb = [239, 239, 239], REGUA: Rgb = [204, 204, 204]
export const MM = 72 / 25.4
export const TAMANHOS_MM: Record<'A4' | 'A5' | 'Letter', readonly [number, number]> = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] }
