import { Registry } from '@polaris/schema'
import { compilaPrograma, registraBase } from '/home/aarao/Documentos/polaris/packages/engine/src/index'
import { empacotaCliente } from '/home/aarao/Documentos/polaris/packages/engine/src/aot/index'
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
async function tam(nome: string, raiz: object, extra: object = {}) {
  const r = new Registry(); registraBase(r)
  const res = compilaPrograma(r, r.registra(no('pagina', nome, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros))
  const p = await empacotaCliente(res.programa)
  if (!p.ok) throw new Error(JSON.stringify(p.motivos))
  console.log(nome.padEnd(24), String(p.pacote.bytes).padStart(6), 'B min', String(p.pacote.gz).padStart(6), 'B gz  funcoes=', p.pacote.uso.funcoes.join(',') || '-')
  if (nome === 'lista-formatos') console.log(Object.entries(p.pacote.contribuicao).sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${k} ${v}`).join('\n'))
  return p.pacote
}
const est = { n: { tipo: 'inteiro', inicial: 0 }, itens: { tipo: 'json', inicial: [] } }
await tam('estatica-simples', P('texto/paragrafo', { props: { texto: 'oi' } }))
await tam('contador', P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'n={estado.n}' } }), P('nav/botao', { props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } })] } }), { estado: est })
await tam('lista-formatos', P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { repetir: { cada: 'ordena(filtra(estado.itens, p => p.ok), p => p.nome)', como: 'p', chave: 'p.id' }, props: { texto: '{p.nome | maiusculas}: {p.preco | brl}' } })] } }), { estado: est })
await tam('dinheiro-exato', P('texto/paragrafo', { props: { texto: '{qbrl(qmul(estado.n, "1.1"))}' } }), { estado: est })
