import type { Registry } from '@polaris/schema'
import { SLOT_NATIVO } from './tipos'

/** Blocos nativos que o próprio runtime entende. Registre no Registry antes de compilar. */
export const NATIVOS = [
  {
    kind: 'bloco', id: 'core.slot', versao: '1.0.0', estatuto: 'publicado',
    spec: { interface: SLOT_NATIVO, titulo: 'Slot', descricao: 'Ponto de inserção dentro do modelo de um bloco composto: o conteúdo que a página põe naquele slot do bloco aparece aqui. Só faz sentido dentro de `modelo`.', props: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
  },
]

export function registraNativos(reg: Registry): void {
  for (const n of NATIVOS) reg.registra(structuredClone(n))
}
