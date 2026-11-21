// Gera exemplos/maison/nos.json: o tema "maison" e as páginas início, produtos e sobre, portados do template "Homeware store" do Lovable.
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
  { slug: 'iluminacao', nome: 'Iluminação', frase: 'Formas escultóricas que lançam calor e sombra', foto: 'colecao-iluminacao' },
  { slug: 'ceramica', nome: 'Cerâmica', frase: 'Peças moldadas à mão, com paciência', foto: 'colecao-ceramica' },
  { slug: 'mobiliario', nome: 'Mobiliário', frase: 'Linhas calmas e madeira de verdade', foto: 'colecao-3' },
  { slug: 'texteis', nome: 'Têxteis', frase: 'Linho, lã e algodão para tocar todo dia', foto: 'colecao-4' },
  { slug: 'objetos', nome: 'Objetos e vasos', frase: 'Pequenos gestos que compõem a casa', foto: 'colecao-5' },
  { slug: 'sazonal', nome: 'Coleção sazonal', frase: 'Luz baixa e perfume de cada estação', foto: 'colecao-6' },
]
// as 8 categorias do filtro da loja (as 6 coleções + novidades e presentes)
const CATEGORIAS = [...COLECOES.map((c) => ({ slug: c.slug, nome: c.nome })), { slug: 'novidades', nome: 'Novidades' }, { slug: 'presentes', nome: 'Presentes selecionados' }]
// os 13 produtos do template, na ordem do filtro "Destaques" (preço em reais, material e selo)
const PRODUTOS = [
  { id: 'arco', colecao: 'iluminacao', nome: 'Luminária Pendente Arco', descricao: 'Um arco gracioso de latão curvado à mão e linho', preco: '485.00', material: 'Latão maciço', foto: 'produto-1', selo: 'Destaque' },
  { id: 'vaso', colecao: 'ceramica', nome: 'Vaso Escultural Grande', descricao: 'Grés torneado à mão com esmalte natural de cinzas', preco: '320.00', material: 'Grés de alta temperatura', foto: 'colecao-ceramica', selo: 'Destaque' },
  { id: 'mesa', colecao: 'mobiliario', nome: 'Mesa de Jantar Colheita', descricao: 'Carvalho maciço feito para gerações à mesa', preco: '2850.00', material: 'Carvalho branco maciço', foto: 'colecao-3', selo: 'Destaque' },
  { id: 'castical', colecao: 'objetos', nome: 'Conjunto de Castiçais Forja', descricao: 'Latão forjado à mão em três alturas graduadas', preco: '245.00', material: 'Latão forjado maciço', foto: 'produto-vela-castical', selo: 'Destaque' },
  { id: 'orbe', colecao: 'iluminacao', nome: 'Luminária de Mesa Orbe', descricao: 'Vidro soprado encontra bronze escultural', preco: '295.00', material: 'Vidro soprado', foto: 'produto-2', selo: 'Novo' },
  { id: 'tigela', colecao: 'ceramica', nome: 'Tigela de Servir do Dia a Dia', descricao: 'Formas simples para os rituais diários', preco: '145.00', material: 'Grés', foto: 'produto-3' },
  { id: 'poltrona', colecao: 'mobiliario', nome: 'Poltrona Trançada', descricao: 'Corda de papel dinamarquesa e nogueira escultural', preco: '1450.00', material: 'Nogueira maciça', foto: 'produto-poltrona', selo: 'Novo' },
  { id: 'manta', colecao: 'texteis', nome: 'Manta de Linho Herança', descricao: 'Linho belga lavado em tons naturais', preco: '195.00', material: '100% linho belga', foto: 'colecao-4' },
  { id: 'almofada', colecao: 'texteis', nome: 'Almofada de Lã Feltrada à Mão', descricao: 'Feita por artesãos com técnicas tradicionais de feltragem', preco: '165.00', material: '100% lã neozelandesa', foto: 'produto-almofada' },
  { id: 'vasinho', colecao: 'objetos', nome: 'Vaso Escultural para Uma Flor', descricao: 'Forma minimalista para uma única haste', preco: '85.00', material: 'Grés', foto: 'colecao-5' },
  { id: 'vela', colecao: 'sazonal', nome: 'Vela Lareira de Inverno', descricao: 'Notas de cedro, fumaça e ervas secas', preco: '65.00', material: 'Cera de soja natural', foto: 'colecao-6' },
  { id: 'bandeja', colecao: 'novidades', nome: 'Bandeja de Mármore Polido', descricao: 'Pedra natural para a beleza de todo dia', preco: '175.00', material: 'Mármore de Carrara', foto: 'foto-3', selo: 'Novo' },
  { id: 'caixa', colecao: 'presentes', nome: 'Caixa de Presente Selecionada', descricao: 'Uma seleção cuidadosa das nossas peças favoritas', preco: '225.00', material: 'Grés', foto: 'produto-caixa-presente' },
]
const NOME_COLECAO = Object.fromEntries(CATEGORIAS.map((c) => [c.slug, c.nome]))
const paraProduto = (p) => ({ id: p.id, colecao: p.colecao, colecaoNome: NOME_COLECAO[p.colecao], nome: p.nome, descricao: p.descricao, preco: p.preco, fotoUrl: foto(p.foto), disponivel: true, material: p.material, ...(p.selo ? { selo: p.selo } : {}) })
const NOVIDADES = ['arco', 'orbe', 'vaso', 'tigela'].map((id) => PRODUTOS.find((p) => p.id === id))
const FOTOS = ['hero', 'foto-1', 'foto-2', 'foto-3', 'colecao-ceramica', 'colecao-5']

// ---- a sacola: estado que PERSISTE no navegador (id e quantidade); o preço vem sempre do catálogo, nunca do que foi guardado -------------------------------
const estadoSacola = { sacola: { tipo: 'json', lista: true, inicial: [], persiste: true } }
const QTD_TOTAL = 'soma(mapeia(estado.sacola, i => i.qtd))'
const adiciona = (id) => `acha(estado.sacola, i => i.id == ${id}) ? mapeia(estado.sacola, i => i.id == ${id} ? com(i, ["qtd"], i.qtd + 1) : i) : concat(estado.sacola, [objeto([["id", ${id}], ["qtd", 1]])])`
const muda = (id, delta) => `filtra(mapeia(estado.sacola, i => i.id == ${id} ? com(i, ["qtd"], i.qtd + ${delta}) : i), i => i.qtd > 0)`
const tira = (id) => `filtra(estado.sacola, i => i.id != ${id})`
const aoClicar = (valor) => ({ aoClicar: [{ acao: 'definir', estado: 'sacola', valor }] })
// as linhas da sacola com o produto do catálogo (item sem produto some), o total de cada uma e o subtotal (dinheiro exato)
const LINHAS = 'filtra(mapeia(estado.sacola, i => objeto([["id", i.id], ["qtd", i.qtd], ["p", acha(estado.produtos, p => p.id == i.id)]])), l => l.p != null)'
const SUBTOTAL = `dobra(${LINHAS}, "0", (acc, l) => qsoma(acc, qmul(l.p.preco, l.qtd)))`

// ---- as partes comuns: cabeçalho e rodapé (o link da página aberta leva `atual`) -------------------------------------------------------------
const cabecalho = (atual) => b('site/cabecalho', {
  titulo: 'Maison', fixo: true, menuCentro: true, href: '/',
  links: [{ texto: 'Loja', href: '/produtos', ...(atual === 'loja' ? { atual: true } : {}) }, { texto: 'Sobre', href: '/sobre', ...(atual === 'sobre' ? { atual: true } : {}) }, { texto: `{"Sacola (" + ${QTD_TOTAL} + ")"}`, href: '/sacola', ...(atual === 'sacola' ? { atual: true } : {}) }],
  grupos: [{ titulo: 'Coleções', links: COLECOES.map((c) => ({ texto: c.nome, href: `/produtos?colecao=${c.slug}` })) }],
})
const rodape = () => b('site/rodape', {
  colunas: [
    { titulo: 'Loja', links: [{ texto: 'Todas as peças', href: '/produtos' }, { texto: 'Novidades', href: '/produtos?colecao=novidades' }, { texto: 'Presentes', href: '/produtos?colecao=presentes' }] },
    { titulo: 'Casa', links: [{ texto: 'Sobre a Maison', href: '/sobre' }, { texto: 'Contato', href: '/sobre#contato' }] },
  ],
  copyright: '© 2026 Maison. Todos os direitos reservados.',
})
const link = (href, texto, botao) => b('nav/link', { href, texto, ...(botao ? { botao } : {}) })

// ---- início ---------------------------------------------------------------------------------------------------------------------------------
const home = b('layout/pilha', { gap: 0 }, [
  cabecalho(),
  // abertura em tela quase cheia, com a foto e o véu escuro; o texto alinha com o resto da página
  b('layout/destaque', { imagem: foto('hero'), altura: 760, escurece: 0.35, alinha: 'esquerda' }, [
    contido([
      sobre('Curadoria para uma vida atenta'),
      titulo('Objetos de beleza serena', 1),
      par('Peças de casa e estilo de vida, escolhidas para dar um sentido calmo ao dia a dia.'),
      link('/produtos', 'Ver as peças', 'primario'),
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
        link(`/produtos?colecao=${COLECOES[0].slug}`, 'Ver iluminação', 'primario'),
      ]),
    ]),
  ]),
  folga(96),
  // novidades sobre o fundo de linho
  b('layout/destaque', { fundo: 'suave', altura: 120, alinha: 'esquerda' }, [
    contido([
      b('layout/linha', { gap: 16, alinha: 'fim', quebra: true }, [
        b('layout/pilha', { gap: 4, cresce: true }, [sobre('Acabou de chegar'), titulo('Novidades', 2)]),
        link('/produtos', 'Ver tudo'),
      ]),
      folga(24),
      b('layout/grade', { colunas: 4, gap: 32 }, NOVIDADES.map((p) => b('commerce/cartao-produto', { fluida: true, proporcao: 0.8, produto: paraProduto(p), href: `/produtos/${p.id}` }))),
    ]),
  ]),
  folga(96),
  // explore por coleção
  contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre('Explore por'), titulo('Coleções', 2)]),
    folga(32),
    b('layout/grade', { colunas: 3, gap: 24 }, COLECOES.map((c) => b('layout/destaque', { imagem: foto(c.foto), altura: 360, escurece: 0.4, alinha: 'esquerda' }, [titulo(c.nome, 3), par(c.frase), link(`/produtos?colecao=${c.slug}`, 'Ver peças')]))),
  ], 'larga', { id: 'colecoes' }),
  folga(96),
  // a faixa de fotos
  contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre('Siga a casa'), titulo('@maison', 2)]),
    folga(24),
    b('layout/grade', { colunas: 6, gap: 8 }, FOTOS.map((f, i) => b('midia/imagem', { src: foto(f), alt: `Foto ${i + 1} da casa`, fluida: true, proporcao: 1 }))),
  ], 'larga'),
  folga(96),
  rodape(),
])

// ---- produtos: filtro por categoria (?colecao=…), contagem e grade com selos --------------------------------------------------------------
const FILTRADOS = 'filtra(estado.produtos, p => (consulta.colecao ?? "") == "" || p.colecao == consulta.colecao)'
const filtro = (slug, nome) => b('nav/link', { href: slug ? `/produtos?colecao=${slug}` : '/produtos', texto: nome, botao: 'secundario', atual: `{(consulta.colecao ?? "") == ${JSON.stringify(slug)}}` }) // o filtro escolhido leva aria-current e fica preenchido
const cartao = { bloco: 'commerce/cartao-produto', props: { fluida: true, proporcao: 0.8, produto: '{p}', href: '{"/produtos/" + p.id}' }, repetir: { cada: FILTRADOS, como: 'p', chave: 'p.id' }, slots: { acoes: [
  { bloco: 'texto/pequeno', props: { texto: '{(p.selo ? p.selo + " · " : "") + p.material}' } }, // o selo (Destaque, Novo) e o material, na linha pequena sob o preço
  { bloco: 'nav/botao', props: { texto: 'Adicionar à sacola', variante: 'secundario' }, eventos: aoClicar(adiciona('p.id')) },
] } }
const produtos = b('layout/pilha', { gap: 0 }, [
  cabecalho('loja'),
  b('layout/destaque', { imagem: foto('loja-capa'), altura: 440, escurece: 0.35, alinha: 'esquerda' }, [contido([sobre('Loja'), titulo('Todas as peças', 1)])]),
  folga(32),
  contido([
    b('layout/linha', { gap: 8, quebra: true }, [filtro('', 'Todas'), ...CATEGORIAS.map((c) => filtro(c.slug, c.nome))]),
    folga(24),
    b('texto/pequeno', { texto: `{tamanho(${FILTRADOS}) + (tamanho(${FILTRADOS}) == 1 ? " peça" : " peças")}` }),
    folga(16),
    b('layout/grade', { colunas: 4, gap: 32 }, [cartao]),
    b('texto/paragrafo', { texto: 'Nenhuma peça nesta categoria ainda.' }, undefined, { se: `tamanho(${FILTRADOS}) == 0` }),
  ], 'larga'),
  folga(96),
  rodape(),
])

// ---- sobre ----------------------------------------------------------------------------------------------------------------------------------
const VALORES = [
  ['01', 'Artesanato', 'Defendemos o trabalho de mãos habilidosas: artesãos que aperfeiçoaram o ofício por anos e criam objetos com um cuidado que máquina nenhuma replica.'],
  ['02', 'Sustentabilidade', 'Escolhemos materiais naturais que envelhecem bem e artesãos que respeitam o ambiente. Qualidade acima de quantidade é menos desperdício e mais sentido.'],
  ['03', 'Vida sem pressa', 'Num mundo em aceleração constante, acreditamos na beleza da pausa. Nossos objetos convidam a momentos de calma e presença no cotidiano.'],
]
const sobre_ = b('layout/pilha', { gap: 0 }, [
  cabecalho('sobre'),
  b('layout/destaque', { imagem: foto('sobre-capa'), altura: 560, escurece: 0.4, alinha: 'esquerda' }, [contido([
    sobre('Nossa história'), titulo('Curadoria de beleza para viver', 1),
    par('Objetos feitos com cuidado, materiais que envelhecem bem e espaços que convidam à pausa.'),
  ])]),
  folga(96),
  contido([sobre('Nossa filosofia'), par('Acreditamos que os objetos que nos cercam devem contar histórias, envelhecer com beleza e trazer uma alegria silenciosa aos momentos do dia a dia.')], 'estreita'),
  folga(96),
  contido([b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      sobre('O começo'), titulo('Uma busca pessoal por sentido', 2),
      par('A Maison nasceu de uma busca pessoal por objetos que tivessem significado numa época em que tudo é descartável. Depois de anos colecionando e selecionando, abrimos as portas para dividir essas descobertas com quem valoriza o ofício acima da conveniência.'),
      par('O que começou como uma pequena coleção virou uma seleção cuidadosa de peças para a casa e o estilo de vida, cada uma escolhida por trazer calor, textura e intenção aos espaços onde vivemos.'),
    ]),
    b('midia/imagem', { src: foto('sobre-1'), alt: 'Sala com objetos selecionados', fluida: true, proporcao: 0.8 }),
  ])]),
  folga(96),
  contido([titulo('“A beleza está na imperfeição das coisas feitas à mão”', 3)], 'estreita'),
  folga(96),
  contido([b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
    b('midia/imagem', { src: foto('sobre-2'), alt: 'Peças de uma oficina', fluida: true, proporcao: 0.8 }),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      sobre('Nossa abordagem'), titulo('Da oficina para a sua casa', 2),
      par('Cada peça da nossa coleção passa pelas nossas mãos antes de chegar às suas. Visitamos oficinas, conhecemos quem faz e aprendemos a história por trás de cada objeto. Esse contato pessoal garante que o que oferecemos não é só bonito: é honesto.'),
      par('Priorizamos materiais naturais, técnicas tradicionais e artesãos que compartilham nossos valores. Seja um vaso de cerâmica torneado à mão ou uma mesa de carvalho feita para durar gerações, acreditamos em objetos que melhoram com o tempo, e não o contrário.'),
    ]),
  ])]),
  folga(96),
  b('layout/destaque', { fundo: 'suave', altura: 120, alinha: 'esquerda' }, [contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre('O que nos guia'), titulo('Nossos valores', 2)]),
    folga(32),
    b('layout/grade', { colunas: 3, gap: 48 }, VALORES.map(([n, t, d]) => b('layout/pilha', { gap: 8, alinha: 'inicio' }, [sobre(n), titulo(t, 3), par(d)]))),
  ])]),
  folga(96),
  contido([b('layout/grade', { colunas: 3, gap: 24 }, ['colecao-ceramica', 'colecao-4', 'produto-almofada'].map((f, i) => b('midia/imagem', { src: foto(f), alt: `Detalhe ${i + 1} das peças`, fluida: true, proporcao: 0.8 })))], 'larga'),
  folga(96),
  b('layout/destaque', { imagem: foto('foto-2'), altura: 420, escurece: 0.45, alinha: 'centro' }, [
    sobre('Vamos conversar'), titulo('Tem alguma dúvida?', 2),
    par('Teremos prazer em falar sobre as nossas peças, os artesãos ou em ajudar você a achar exatamente o que procura.'),
    link('/produtos', 'Ver as peças', 'primario'),
  ], { id: 'contato' }),
  rodape(),
])

// ---- detalhe do produto: /produtos/:id (foto, dados, adicionar à sacola e outras peças da mesma coleção) -----------------------------------------------
const ACHADO = 'filtra(estado.produtos, p => p.id == params.id)'
const MESMA = 'fatia(filtra(estado.produtos, o => o.colecao == p.colecao && o.id != p.id), 0, 4)'
const detalhe = b('layout/pilha', { gap: 0 }, [
  cabecalho('loja'),
  folga(48),
  { ...b('layout/pilha', { gap: 0 }, [
    contido([
      link('/produtos', '← Todas as peças'),
      folga(24),
      b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
        b('midia/imagem', { src: '{p.fotoUrl}', alt: '{p.nome}', fluida: true, proporcao: 0.8 }),
        b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
          sobre('{p.colecaoNome}'),
          titulo('{p.nome}', 1),
          b('commerce/preco', { valor: '{p.preco}' }),
          par('{p.descricao}'),
          b('texto/pequeno', { texto: '{"Material: " + p.material}' }),
          b('texto/pequeno', { texto: 'Feita à mão, em pequenas séries. Cada peça pode variar levemente.' }),
          folga(8),
          b('layout/linha', { gap: 12, quebra: true }, [
            b('nav/botao', { texto: 'Adicionar à sacola' }, undefined, { eventos: aoClicar(adiciona('p.id')) }),
            link('/sacola', 'Ver a sacola'),
          ]),
        ]),
      ]),
    ], 'larga'),
    folga(96),
    contido([
      b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre('Da mesma coleção'), titulo('Você também pode gostar', 2)]),
      folga(32),
      b('layout/grade', { colunas: 4, gap: 32 }, [{ bloco: 'commerce/cartao-produto', props: { fluida: true, proporcao: 0.8, produto: '{o}', href: '{"/produtos/" + o.id}' }, repetir: { cada: MESMA.replace(/\bp\./g, 'p.'), como: 'o', chave: 'o.id' } }]),
    ], 'larga', { se: `tamanho(${MESMA}) > 0` }),
  ]), repetir: { cada: ACHADO, como: 'p', chave: 'p.id' } },
  contido([
    sobre('Peça não encontrada'), titulo('Não achamos esta peça', 2), par('Ela pode ter saído da coleção.'), link('/produtos', 'Ver todas as peças', 'primario'),
  ], 'estreita', { se: `tamanho(${ACHADO}) == 0` }),
  folga(96),
  rodape(),
])

// ---- sacola: linhas com foto, quantidade (− e +), remover, subtotal e o aviso de que o pagamento ainda não existe --------------------------------------
const linha = b('layout/linha', { gap: 24, alinha: 'centro', quebra: true }, [
  b('midia/imagem', { src: '{l.p.fotoUrl}', alt: '{l.p.nome}', proporcao: 0.8, largura: 96 }),
  b('layout/pilha', { gap: 4, cresce: true, alinha: 'inicio' }, [titulo('{l.p.nome}', 3), b('texto/pequeno', { texto: '{l.p.material}' }), b('texto/pequeno', { texto: '{l.p.preco | qbrl}' })]),
  b('layout/linha', { gap: 8, alinha: 'centro' }, [
    b('nav/botao', { texto: '−', variante: 'secundario' }, undefined, { eventos: aoClicar(muda('l.id', '-1')) }),
    b('texto/rotulo', { texto: '{l.qtd}' }),
    b('nav/botao', { texto: '+', variante: 'secundario' }, undefined, { eventos: aoClicar(muda('l.id', '1')) }),
  ]),
  b('texto/rotulo', { texto: '{qmul(l.p.preco, l.qtd) | qbrl}' }),
  b('nav/botao', { texto: 'Remover', variante: 'secundario' }, undefined, { eventos: aoClicar(tira('l.id')) }),
])
const sacolaPag = b('layout/pilha', { gap: 0 }, [
  cabecalho('sacola'),
  folga(64),
  contido([
    sobre('Sua seleção'), titulo('Sacola', 1), folga(24),
    b('layout/pilha', { gap: 24 }, [{ ...linha, repetir: { cada: LINHAS, como: 'l', chave: 'l.id' } }]),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [titulo('Sua sacola está vazia', 3), par('Escolha peças na loja e elas ficam guardadas aqui, mesmo se você fechar a página.'), link('/produtos', 'Ver as peças', 'primario')], { se: `tamanho(${LINHAS}) == 0` }),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      folga(16),
      b('commerce/resumo-pedido', { subtotal: `{${SUBTOTAL}}`, total: `{${SUBTOTAL}}` }),
      par('Frete e pagamento serão calculados no fechamento do pedido (ainda não disponível neste exemplo).'),
      link('/produtos', 'Continuar comprando'),
    ], { se: `tamanho(${LINHAS}) > 0` }),
  ], 'estreita'),
  folga(96),
  rodape(),
])

const pagina = (id, rota, titulo, raiz, extra = {}) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota, titulo, raiz, ...extra, estado: { ...estadoSacola, ...(extra.estado ?? {}) } } })
const naoAchada = b('layout/pilha', { gap: 16, alinha: 'centro' }, [titulo('Página não encontrada', 1), par('O endereço não existe nesta loja.'), link('/', 'Voltar ao início', 'primario')])
const PAGINAS = ['maison.home', 'maison.produtos', 'maison.produto', 'maison.sobre', 'maison.sacola', 'maison.nao']
const tenant = (id, tenantId, nome) => ({ kind: 'tenant', id, tenantId, versao: '1.0.0', estatuto: 'publicado', spec: { alias: id, nome, segmento: 'varejo', modulos: ['loja'], tema: 'maison', paginas: PAGINAS, paginaNaoEncontrada: 'maison.nao' } })

const nos = [
  tema,
  pagina('maison.home', '/', 'Maison', home),
  pagina('maison.produtos', '/produtos', 'Todas as peças · Maison', produtos, { estado: { produtos: { tipo: 'json', inicial: PRODUTOS.map(paraProduto) } } }),
  pagina('maison.produto', '/produtos/:id', 'Peça · Maison', detalhe, { params: { id: { tipo: 'texto' } }, estado: { produtos: { tipo: 'json', lista: true, inicial: PRODUTOS.map(paraProduto) } } }),
  pagina('maison.sobre', '/sobre', 'Sobre · Maison', sobre_),
  pagina('maison.sacola', '/sacola', 'Sacola · Maison', sacolaPag, { estado: { produtos: { tipo: 'json', lista: true, inicial: PRODUTOS.map(paraProduto) } } }),
  pagina('maison.nao', '/nao-encontrada', 'Página não encontrada', naoAchada),
  tenant('loja-demo', '11111111-1111-1111-1111-111111111111', 'Loja Demo'),
  tenant('loja-outra', '22222222-2222-2222-2222-222222222222', 'Outra Loja'),
]
writeFileSync(join(aqui, 'nos.json'), `${JSON.stringify(nos, null, 2)}\n`)
console.log(`exemplos/maison/nos.json: ${nos.length} nós (tema, ${nos.filter((n) => n.kind === 'pagina').length} páginas, ${nos.filter((n) => n.kind === 'tenant').length} tenants)`)
