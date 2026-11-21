// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const LISTA = 'csv("nome,arr\\nAcme,100\\n=Evil,5")'
const res = compilaPrograma(r, r.registra(no('pagina', 'baixar', { rota: '/', estado: { contas: { tipo: 'json', lista: true, inicial: [] }, nome: { tipo: 'texto', inicial: 'carteira' } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('nav/botao', { id: 'le', props: { texto: 'ler' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'contas', valor: LISTA }] } }),
  P('nav/botao', { id: 'exporta', props: { texto: 'exportar' }, eventos: { aoClicar: [{ acao: 'baixar', nome: '{estado.nome}.csv', tipo: 'text/csv', valor: 'csvTexto(estado.contas, ["nome", "arr"])' }] } }),
  P('nav/botao', { id: 'ruim', props: { texto: 'ruim' }, eventos: { aoClicar: [{ acao: 'baixar', nome: '../../etc/passwd', valor: '"x"' }] } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))

describe('ação baixar + csv', () => {
  it('gera o arquivo (nome limpo, tipo, conteúdo) a partir do estado; CSV lido vira lista e volta como texto protegido', () => {
    const c = document.createElement('div'); document.body.appendChild(c); const arquivos: Array<{ nome: string; tipo: string; conteudo: string }> = []
    montaVivo({ programa: res.programa, container: c, baixar: (a) => arquivos.push(a) })
    const click = (id: string) => c.querySelector(`#${id}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    click('le'); click('exporta')
    expect(arquivos).toEqual([{ nome: 'carteira.csv', tipo: 'text/csv', conteudo: "nome,arr\r\nAcme,100\r\n'=Evil,5" }])
    click('ruim'); expect(arquivos[1]!.nome).toBe('-..-etc-passwd'); expect(arquivos[1]!.nome).not.toMatch(/[\\/]/) // sem pastas
    expect(arquivos[1]).toMatchObject({ tipo: 'text/plain', conteudo: 'x' })
  })
})
