// Modelo do cartaz já RESOLVIDO e calculado, em pontos (pt), origem no canto superior esquerdo, y para baixo. HTML e PDF consomem ISTO e só desenham:
// quebra de linha, tamanho de fonte e posições são decididos UMA vez, no layout; é isso que faz as duas saídas coincidirem.
export type Rgb = [number, number, number]
export type Peso = 'normal' | 'negrito'
export type OpTexto = { tipo: 'texto'; x: number; yTopo: number; texto: string; familia: string; peso: Peso; tamanho: number; cor: Rgb; ascender: number; alturaLinha: number; /** graus ANTI-HORÁRIO em torno de (x, yTopo) */ graus: number }
export type OpRet = { tipo: 'ret'; x: number; y: number; l: number; a: number; cor: Rgb; opacidade: number }
/** forma vetorial (retângulo arredondado e/ou girado): o MESMO `d` (SVG, pt, y para baixo) vai para o HTML e para o PDF */
export type OpCaminho = { tipo: 'caminho'; d: string; cor: Rgb; opacidade: number }
export type OpImagem = { tipo: 'imagem'; x: number; y: number; l: number; a: number; src: string; alt: string }
export type Op = OpTexto | OpRet | OpCaminho | OpImagem
export type Pagina = { largura: number; altura: number; ops: Op[] }
export type Layout = { paginas: Pagina[]; largura: number; altura: number; titulo: string; avisos: string[] }

export const MM = 72 / 25.4
export const TAMANHOS_MM: Record<'A4' | 'A5' | 'A6' | 'A7', readonly [number, number]> = { A4: [210, 297], A5: [148, 210], A6: [105, 148], A7: [74, 105] }
