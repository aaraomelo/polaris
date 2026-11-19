// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, registraBase, montaVivo, type Programa } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms))
function programa(tamanhoMax?: number): Programa {
  const r = new Registry(); registraBase(r)
  const res = compilaPrograma(r, r.registra(no('pagina', `arq${tamanhoMax ?? 0}`, {
    rota: '/', estado: { resumo: { tipo: 'texto', inicial: 'nada' } },
    raiz: { bloco: 'layout/pilha', slots: { filhos: [
      { bloco: 'entrada/arquivo', id: 'f', props: { rotulo: 'Imagem', aceita: 'image/png', ...(tamanhoMax ? { tamanhoMax } : {}) }, eventos: { aoEscolher: [{ acao: 'definir', estado: 'resumo', valor: 'evento.nome + "|" + evento.tipo + "|" + evento.tamanho + "|" + evento.dados' }], aoRecusar: [{ acao: 'definir', estado: 'resumo', valor: '"recusa: " + evento.erro' }] } },
      { bloco: 'texto/paragrafo', id: 'r', props: { texto: '{estado.resumo}' } },
    ] } },
  })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const escolhe = async (c: HTMLElement, arq: File) => {
  const i = c.querySelector('#f') as HTMLInputElement; Object.defineProperty(i, 'files', { value: [arq], configurable: true }); i.dispatchEvent(new Event('change', { bubbles: true })); await espera(60)
}

describe('entrada/arquivo', () => {
  it('é <input type=file> com accept, nome acessível e o limite em data-max', () => {
    const c = document.createElement('div'); montaVivo({ programa: programa(), container: c }); const i = c.querySelector('#f') as HTMLInputElement
    expect([i.type, i.getAttribute('accept'), i.getAttribute('aria-label'), i.getAttribute('data-max')]).toEqual(['file', 'image/png', 'Imagem', '2097152'])
  })
  it('ao escolher, o evento traz nome, tipo, tamanho e os bytes em base64, e as ações rodam quando o arquivo termina de ser lido', async () => {
    const c = document.createElement('div'); montaVivo({ programa: programa(), container: c })
    await escolhe(c, new File([new Uint8Array([1, 2, 3, 250])], 'a.png', { type: 'image/png' })); expect(c.querySelector('#r')!.textContent).toBe(`a.png|image/png|4|${Buffer.from([1, 2, 3, 250]).toString('base64')}`) // e aoRecusar não rodou por cima
  })
  it('acima de `tamanhoMax` o arquivo nem é lido: só `aoRecusar` roda (com `erro`) e `aoEscolher` NÃO', async () => {
    const c = document.createElement('div'); montaVivo({ programa: programa(1024), container: c })
    await escolhe(c, new File([new Uint8Array(2000)], 'grande.png', { type: 'image/png' })); expect(c.querySelector('#r')!.textContent).toBe('recusa: o arquivo passa de 1 KB')
  })
  it('sem arquivo (seleção cancelada) vira recusa, não exceção', async () => {
    const c = document.createElement('div'); montaVivo({ programa: programa(), container: c }); const i = c.querySelector('#f') as HTMLInputElement
    Object.defineProperty(i, 'files', { value: [], configurable: true }); i.dispatchEvent(new Event('change', { bubbles: true })); await espera(40); expect(c.querySelector('#r')!.textContent).toBe('recusa: nenhum arquivo escolhido')
  })
})
