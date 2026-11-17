import type { Funcoes } from './tipos'

// Biblioteca padrão REGISTRADA, não importada: o núcleo do runtime (que vai para o navegador) pede `funcoesPadrao()` só quando ninguém passou
// `funcoes`. Quem importa `expr/funcoes` (servidor, testes, `@polaris/engine`) registra a biblioteca completa por efeito colateral; um bundle
// de cliente por página (src/aot) NÃO importa esse módulo e passa só as funções que a página usa. Assim o bundler descarta o resto.
let atual: Funcoes | undefined

export function definePadrao(f: Funcoes): void { atual = f }

export function funcoesPadrao(): Funcoes {
  if (!atual) throw new Error("biblioteca padrão não registrada: importe '@polaris/engine' ou passe `funcoes` ao runtime")
  return atual
}

// o mesmo para os descritores DOM dos blocos base
import type { DescritoresDom } from '../vivo/blocos'
let descritores: DescritoresDom | undefined
export function definePadraoDescritores(d: DescritoresDom): void { descritores = d }
export function descritoresPadrao(): DescritoresDom {
  if (!descritores) throw new Error("descritores padrão não registrados: importe '@polaris/engine' ou passe `descritores` ao runtime")
  return descritores
}
