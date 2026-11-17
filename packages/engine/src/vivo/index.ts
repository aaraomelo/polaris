export { DESCRITORES_BASE, type Descritor, type DescritoresDom } from './blocos'
import { DESCRITORES_BASE as BASE } from './blocos'
import { definePadraoDescritores } from '../expr/padrao'
definePadraoDescritores(BASE)
export { aplicaLista, planoLista, lis, ChaveDuplicada, type PlanoLista } from './lista'
import { montaVivoNucleo, type OpcoesVivo, type Vivo } from './monta'
import { constroiCodigo } from './codigo'
import { anexaHistorico, type Modelo } from '../modelo/historico'
export { elegivelVivo, montaVivoNucleo, type OpcoesVivo, type Vivo } from './monta'

/** Runtime vivo COMPLETO: o núcleo + histórico (`historico: N` guarda N mudanças; `modelo.desfaz()` / `refaz()`). */
export function montaVivo(o: OpcoesVivo & { historico?: number }): Vivo & { modelo: Modelo } {
  const v = montaVivoNucleo({ blocoCodigo: constroiCodigo, ...o })
  anexaHistorico(v.modelo, o.historico ?? 0)
  return v as Vivo & { modelo: Modelo }
}
export { Divergencia, Pos } from './pos'
export { emissoresDe, emissorDe } from './emissor'
export { constroiCodigo } from './codigo'
export type { ArgsBlocoCodigo, ConstroiCodigo, CtrlPublico } from './monta'
