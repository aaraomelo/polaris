// Gera, para a MESMA página de loja, a variante React (SSR + hidratação) e a variante vivo (AOT, sem React) em bench/navegador/saida/.
//   pnpm vite-node bench/navegador/gera.ts
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Registry } from '@polaris/schema'
import { construirAot } from '../../src/aot/index'
import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml } from '../../src/index'

const raiz = resolve(__dirname, '..', '..')
const saida = join(__dirname, 'saida')
rmSync(saida, { recursive: true, force: true }); mkdirSync(saida, { recursive: true })
copyFileSync(join(__dirname, 'medir.js'), join(saida, 'medir.js'))

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const botao = (id: string, texto: string, valor: string, estado = 'itens') => P('nav/botao', { id, props: { texto }, eventos: { aoClicar: [{ acao: 'definir', estado, valor }] } })

function registro(n: number) {
  const r = new Registry(); registraBase(r)
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { nome: { type: 'string' }, preco: { type: 'number' }, qtd: { type: 'integer' } } },
    modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [P('texto/titulo', { props: { texto: '{props.nome}', nivel: 3 } }), P('texto/paragrafo', { props: { texto: '{props.preco | brl} × {props.qtd}' } })] } }) }))
  const itens = Array.from({ length: n }, (_, i) => ({ id: i, nome: `Produto ${i} ${['pão', 'bolo', 'café', 'suco'][i % 4]}`, preco: 10 + (i % 50) * 1.5, qtd: 1 + (i % 5) }))
  r.registra(no('pagina', 'loja', { rota: '/', titulo: 'Loja ({estado.n})',
    estado: { n: { tipo: 'inteiro', inicial: 0 }, filtro: { tipo: 'texto', inicial: '' }, itens: { tipo: 'json', inicial: itens } },
    raiz: P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: 'Loja' } }),
      P('texto/paragrafo', { id: 'n', props: { texto: '{estado.n}' } }),
      botao('b-n', '+1', 'estado.n + 1', 'n'),
      botao('b-um', 'alterar 1', `atualiza(estado.itens, [${n >> 1}, "preco"], v => v + 1)`),
      botao('b-add', 'inserir', `insere(estado.itens, ${n >> 1}, objeto([["id", tamanho(estado.itens) + 100000], ["nome", "novo"], ["preco", 9.9], ["qtd", 1]]))`),
      botao('b-rem', 'remover', `sem(estado.itens, [${n >> 1}])`),
      botao('b-inv', 'inverter', 'inverte(estado.itens)'),
      P('entrada/texto', { id: 'campo', props: { valor: '{estado.filtro}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'filtro', valor: 'evento' }] } }),
      P('layout/pilha', { id: 'lista', slots: { filhos: [P('x/cartao', { repetir: { cada: 'filtra(estado.itens, p => contem(minusculas(p.nome), minusculas(estado.filtro)))', como: 'p', chave: 'p.id' }, props: { nome: '{p.nome}', preco: '{p.preco}', qtd: '{p.qtd}' } })] } }),
    ] } }) }))
  return r
}

const injeta = (html: string) => html.replace('<head>', '<head><script src="/medir.js"></script>')

for (const n of [200, 900]) {
  const reg = registro(n)
  const c = compilaPrograma(reg, reg.resolve('pagina', 'loja', {})!.no)
  if (!c.ok) throw new Error(JSON.stringify(c.erros))
  // --- React: SSR + hidratação (o caminho de hoje) ---
  const dirR = join(saida, `react-${n}`); mkdirSync(dirR, { recursive: true })
  const ssr = renderPaginaHtml({ programa: c.programa, componentes: COMPONENTES_BASE }, { scripts: [] })
  const cliente = await build({
    stdin: { contents: `import { hidrata } from './src/render/cliente'; import { COMPONENTES_BASE } from './src/render/base'; hidrata(COMPONENTES_BASE)`, resolveDir: raiz, loader: 'ts' },
    bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  })
  writeFileSync(join(dirR, 'cliente.js'), cliente.outputFiles[0]!.contents)
  writeFileSync(join(dirR, 'index.html'), injeta(ssr.html.replace('</body>', '<script src="cliente.js"></script></body>')))
  // --- Vivo: AOT (HTML marcado + bundle só do que a página usa, sem React) ---
  const dirV = join(saida, `vivo-${n}`)
  const [r] = await construirAot(reg, { destino: join(saida, `.build-${n}`) })
  if (!r!.ok) throw new Error(JSON.stringify(r!.erros))
  const e = r!.manifesto.paginas.loja!
  mkdirSync(dirV, { recursive: true })
  const fonte = join(saida, `.build-${n}`, 'core')
  copyFileSync(join(fonte, e.arquivos.cliente!.nome), join(dirV, e.arquivos.cliente!.nome))
  writeFileSync(join(dirV, 'index.html'), injeta(readFileSync(join(fonte, e.arquivos.html!.nome), 'utf8')))
  console.log(`n=${n}: react html ${(ssr.html.length / 1024).toFixed(0)} KB, cliente ${(cliente.outputFiles[0]!.contents.length / 1024).toFixed(0)} KB | vivo modo=${e.modo}, cliente ${(e.arquivos.cliente!.bytes / 1024).toFixed(0)} KB (gz ${(e.arquivos.cliente!.gz / 1024).toFixed(1)}), html ${(e.arquivos.html!.bytes / 1024).toFixed(0)} KB`)
}
rmSync(join(saida, '.build-200'), { recursive: true, force: true }); rmSync(join(saida, '.build-900'), { recursive: true, force: true })
console.log('pronto: bench/navegador/saida/{react,vivo}-{200,900}/')
