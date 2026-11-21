// Gera exemplos/maison/nos.json: o tema "maison" e a página inicial, portados do template "Homeware store" do Lovable.
//   node exemplos/maison/gera.mjs            (rode depois de mexer aqui ou em img/)
//   pnpm local --site exemplos/maison         (sobe o ambiente local com este site nos dois tenants de demonstração)
// As fotos ficam em img/ e a página as aponta por `@img/<nome-do-arquivo>` e o ambiente local troca pelo endereço do ativo salvo (o identificador é o hash do que fica depois da limpeza de metadados, que só o upload conhece). O texto é conteúdo de exemplo em pt-BR.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const foto = (nome) => { readFileSync(join(aqui, 'img', `${nome}.jpg`)); return `@img/${nome}` } // confere que o arquivo existe; o ambiente troca `@img/<nome>` pelo endereço do ativo

// ---- o tema: paleta quente (terracota, linho, carvão) do template, claro e escuro; títulos em serifa --------------------------------------
const tema = {
  kind: 'tema', id: 'maison', versao: '1.0.0', estatuto: 'publicado',
  spec: {
    tokens: {
      cor: {
        primaria: '#9f5a3c', primariaHover: '#7f4830', primariaClara: '#f3ece2', secundaria: '#2a2622', destaque: '#c07859',
        fundo: '#faf8f5', superficie: '#f6f4ee', superficieAlt: '#f2eee9', borda: '#e5e0dc', texto: '#2a2622', textoSuave: '#6c645c',
        sucesso: '#37704a', alerta: '#8a5a10', erro: '#b42323', textoSobrePrimaria: '#ffffff',
      },
      raio: { pequeno: 0, grande: 4 },
      espacamento: { base: '0.5rem', borda: 1 },
      tipografia: { familia: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", familiaTitulo: "'Cormorant Garamond', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif", pesoTitulo: 500, tamanhoBase: '16px', tamanhoH1: 'clamp(2.75rem, 6.5vw, 5rem)', tamanhoH2: 'clamp(2rem, 4vw, 3rem)', tamanhoH3: '1.625rem' },
      layout: { largura: '80rem', larguraEstreita: '48rem', larguraLarga: '90rem' },
    },
    modos: {
      escuro: {
        cor: {
          primaria: '#c67553', primariaHover: '#cf8b6e', primariaClara: '#352e27', secundaria: '#ebe7e0', destaque: '#d29479',
          fundo: '#1c1a17', superficie: '#221f1c', superficieAlt: '#322e29', borda: '#3e3832', texto: '#ebe7e0', textoSuave: '#a3998f',
          sucesso: '#7bbf8a', alerta: '#e0b060', erro: '#f08a8a', textoSobrePrimaria: '#1c1a17',
        },
      },
    },
  },
}

// ---- blocos ---------------------------------------------------------------------------------------------------------------------------------
const b = (bloco, props, filhos, extra = {}) => ({ bloco, ...(props ? { props } : {}), ...(filhos ? { slots: { filhos } } : {}), ...extra })
const titulo = (texto, nivel) => b('texto/titulo', { texto, nivel })
const par = (texto) => b('texto/paragrafo', { texto })
const sobre = (texto) => b('texto/sobretitulo', { texto })
const contido = (filhos, largura, extra = {}) => b('layout/contido', largura ? { largura } : undefined, filhos, extra)
const folga = (tamanho) => b('layout/espacador', { tamanho })

const COLECOES = [
  { nome: 'Iluminação', frase: 'Formas escultóricas que lançam calor e sombra', foto: 'colecao-iluminacao' },
  { nome: 'Cerâmica', frase: 'Peças moldadas à mão, com paciência', foto: 'colecao-ceramica' },
  { nome: 'Têxteis', frase: 'Linho, lã e algodão para tocar todo dia', foto: 'colecao-3' },
  { nome: 'Mobiliário', frase: 'Linhas calmas e madeira de verdade', foto: 'colecao-4' },
  { nome: 'Objetos', frase: 'Pequenos gestos que compõem a casa', foto: 'colecao-5' },
  { nome: 'Velas e aromas', frase: 'Luz baixa e perfume suave', foto: 'colecao-6' },
]
const NOVIDADES = [
  { id: 'arco', nome: 'Luminária Arco', descricao: 'Um arco gracioso de latão curvado à mão e linho', preco: '485.00', foto: 'produto-1' },
  { id: 'pendente', nome: 'Pendente de Vidro', descricao: 'Vidro soprado encontra o bronze escultural', preco: '295.00', foto: 'produto-2' },
  { id: 'vaso', nome: 'Vaso de Grés', descricao: 'Grés torneado à mão, com esmalte de cinzas', preco: '320.00', foto: 'produto-3' },
  { id: 'tigela', nome: 'Tigela de Grés', descricao: 'Formas simples para os rituais do dia a dia', preco: '145.00', foto: 'colecao-ceramica' },
]
const FOTOS = ['hero', 'foto-1', 'foto-2', 'foto-3', 'colecao-ceramica', 'colecao-5']

const home = b('layout/pilha', { gap: 0 }, [
  b('site/cabecalho', {
    titulo: 'Maison', fixo: true, menuCentro: true, href: '/',
    links: [{ texto: 'Loja', href: '#novidades' }, { texto: 'Sobre', href: '#sobre' }],
    grupos: [{ titulo: 'Coleções', links: COLECOES.map((c) => ({ texto: c.nome, href: '#colecoes' })) }],
  }),
  // abertura em tela quase cheia, com a foto e o véu escuro; o texto alinha com o resto da página
  b('layout/destaque', { imagem: foto('hero'), altura: 760, escurece: 0.35, alinha: 'esquerda' }, [
    contido([
      sobre('Curadoria para uma vida atenta'),
      titulo('Objetos de beleza serena', 1),
      par('Peças de casa e estilo de vida, escolhidas para dar um sentido calmo ao dia a dia.'),
      b('nav/link', { href: '#colecoes', texto: 'Ver as coleções', botao: 'primario' }),
    ]),
  ]),
  folga(96),
  // coleção em destaque: foto à esquerda, texto à direita, centrado na vertical
  contido([
    b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
      b('midia/imagem', { src: foto(COLECOES[0].foto), alt: COLECOES[0].nome, fluida: true, proporcao: 0.8 }),
      b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
        sobre('Coleção em destaque'),
        titulo(COLECOES[0].nome, 2),
        par(`${COLECOES[0].frase}. Descubra formas escultóricas que transformam qualquer espaço num santuário de luz.`),
        b('nav/link', { href: '#colecoes', texto: 'Ver iluminação', botao: 'primario' }),
      ]),
    ]),
  ]),
  folga(96),
  // novidades sobre o fundo de linho
  b('layout/destaque', { fundo: 'suave', altura: 120, alinha: 'esquerda' }, [
    contido([
      b('layout/linha', { gap: 16, alinha: 'fim', quebra: true }, [
        b('layout/pilha', { gap: 4, cresce: true }, [sobre('Acabou de chegar'), titulo('Novidades', 2)]),
        b('nav/link', { href: '#novidades', texto: 'Ver tudo' }),
      ]),
      folga(24),
      b('layout/grade', { colunas: 4, gap: 32 }, NOVIDADES.map((p) => b('commerce/cartao-produto', { fluida: true, proporcao: 0.8, produto: { id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, fotoUrl: foto(p.foto), disponivel: true }, href: `#${p.id}` }))),
    ]),
  ], { id: 'novidades' }),
  folga(96),
  // explore por coleção
  contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre('Explore por'), titulo('Coleções', 2)]),
    folga(32),
    b('layout/grade', { colunas: 3, gap: 24 }, COLECOES.map((c) => b('layout/destaque', { imagem: foto(c.foto), altura: 360, escurece: 0.4, alinha: 'esquerda' }, [titulo(c.nome, 3), par(c.frase)]))),
  ], 'larga', { id: 'colecoes' }),
  folga(96),
  // a faixa de fotos
  contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre('Siga a casa'), titulo('@maison', 2)]),
    folga(24),
    b('layout/grade', { colunas: 6, gap: 8 }, FOTOS.map((f, i) => b('midia/imagem', { src: foto(f), alt: `Foto ${i + 1} da casa`, fluida: true, proporcao: 1 }))),
  ], 'larga', { id: 'sobre' }),
  folga(96),
  b('site/rodape', {
    colunas: [
      { titulo: 'Loja', links: [{ texto: 'Novidades', href: '#novidades' }, { texto: 'Coleções', href: '#colecoes' }] },
      { titulo: 'Casa', links: [{ texto: 'Sobre a Maison', href: '#sobre' }, { texto: 'Contato', href: '/contato' }] },
    ],
    copyright: '© 2026 Maison. Todos os direitos reservados.',
  }),
])

const pagina = (id, rota, titulo, raiz, extra = {}) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota, titulo, raiz, ...extra } })
const naoAchada = b('layout/pilha', { gap: 16, alinha: 'centro' }, [titulo('Página não encontrada', 1), par('O endereço não existe nesta loja.'), b('nav/link', { href: '/', texto: 'Voltar ao início', botao: 'primario' })])
const tenant = (id, tenantId, nome) => ({ kind: 'tenant', id, tenantId, versao: '1.0.0', estatuto: 'publicado', spec: { alias: id, nome, segmento: 'varejo', modulos: ['loja'], tema: 'maison', paginas: ['maison.home', 'maison.nao'], paginaNaoEncontrada: 'maison.nao' } })

const nos = [
  tema,
  pagina('maison.home', '/', 'Maison', home),
  pagina('maison.nao', '/nao-encontrada', 'Página não encontrada', naoAchada),
  tenant('loja-demo', '11111111-1111-1111-1111-111111111111', 'Loja Demo'),
  tenant('loja-outra', '22222222-2222-2222-2222-222222222222', 'Outra Loja'),
]
writeFileSync(join(aqui, 'nos.json'), `${JSON.stringify(nos, null, 2)}\n`)
console.log(`exemplos/maison/nos.json: ${nos.length} nós (tema, ${nos.filter((n) => n.kind === 'pagina').length} páginas, ${nos.filter((n) => n.kind === 'tenant').length} tenants)`)
