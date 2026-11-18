import { readFileSync } from 'node:fs'

/** o exemplo do schema (a fonte única do cartaz de oferta): o teste exercita o MESMO JSON que o contrato valida */
export const NO_OFERTA = JSON.parse(readFileSync(new URL('../../schema/test/exemplos/validos/cartaz-oferta.json', import.meta.url), 'utf8')) as { kind: string; id: string; spec: Record<string, any> }
export const DADOS_OFERTA = { produto: { nome: 'Arroz Tipo 1 Camil 5kg' }, preco: { de: '12.90', por: '9.99' } }
export const DADOS_LONGO = { produto: { nome: 'Sabonete Líquido Antibacteriano com Extrato de Camomila e Aloe Vera Refil 500 ml' }, preco: { de: '', por: '1234.50' } }

/** cobre o que o motor sabe fazer: fundo em imagem não (sem rede/arquivo), mas rotação, cantos arredondados, transparência, alinhamentos e quebra */
export const SPEC_VARIADO: Record<string, any> = {
  tamanho: 'A4', orientacao: 'retrato', titulo: 'Variado', fundo: { cor: [250, 250, 250] }, fonte: { familia: 'Montserrat', peso: 'negrito' }, dados: { nome: { tipo: 'texto' } },
  elementos: [
    { tipo: 'faixa', id: 'f1', caixa: { topo: 0.05, esquerda: 0.1, largura: 0.8, altura: 0.12 }, cor: [30, 60, 160], raio: 0.3 },
    { tipo: 'texto', id: 't1', texto: '{nome}', caixa: { topo: 0.06, esquerda: 0.12, largura: 0.76, altura: 0.1 }, cor: [255, 255, 255], alinhaV: 'meio' },
    { tipo: 'faixa', id: 'f2', caixa: { topo: 0.3, esquerda: 0.2, largura: 0.6, altura: 0.08 }, cor: [220, 40, 40], opacidade: 0.6, rotacao: 12, raio: 0.2 },
    { tipo: 'texto', id: 't2', texto: 'Girado Trinta Graus Fundo', caixa: { topo: 0.5, esquerda: 0.15, largura: 0.7, altura: 0.07 }, rotacao: 30, fundo: [255, 220, 0, 0.5], alinhaH: 'esquerda', fonte: { familia: 'Roboto', peso: 'normal' } },
    { tipo: 'texto', id: 't3', texto: 'À direita, na base, em duas ou três linhas de texto corrido', caixa: { topo: 0.7, direita: 0.08, largura: 0.5, altura: 0.2 }, alinhaH: 'direita', alinhaV: 'base', cor: [10, 120, 60] },
    { tipo: 'texto', id: 't4', texto: 'uma linha só, sem quebrar, encolhe até caber', caixa: { topo: 0.93, esquerda: 0.05, largura: 0.5, altura: 0.04 }, quebra: 'nenhuma', alinhaH: 'esquerda' },
  ],
}

export const NO_ETIQUETA = JSON.parse(readFileSync(new URL('../../schema/test/exemplos/validos/cartaz-etiqueta.json', import.meta.url), 'utf8')) as { kind: string; id: string; spec: Record<string, any> }
export const DADOS_ETIQUETA = { produto: { nome: 'Café Torrado e Moído 500 g', ean: '7891000100103' }, link: 'https://exemplo.com.br/p/7891000100103?ref=etiqueta' }

export const NO_PRECO = JSON.parse(readFileSync(new URL('../../schema/test/exemplos/validos/cartaz-preco.json', import.meta.url), 'utf8')) as { kind: string; id: string; spec: Record<string, any> }
export const DADOS_PRECO = { produto: { nome: 'Feijão Carioca Tipo 1 1kg', unidade: 'KG' }, preco: { de: '12.9', por: '1234.5' } }
