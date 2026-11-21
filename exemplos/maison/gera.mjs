// Gera exemplos/maison/nos.json: o tema "maison" e as páginas início, produtos e sobre, portados do template "Homeware store" do Lovable.
//   node exemplos/maison/gera.mjs            (rode depois de mexer aqui ou em img/)
//   pnpm local --site exemplos/maison         (sobe o ambiente local com este site nos dois tenants de demonstração)
// As fotos ficam em img/ e a página as aponta por `@img/<nome-do-arquivo>` e o ambiente local troca pelo endereço do ativo salvo (o identificador é o hash do que fica depois da limpeza de metadados, que só o upload conhece). O texto é conteúdo de exemplo em pt-BR.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDIOMAS, MENSAGENS, PADRAO, doDicionario } from './idiomas.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))
const foto = (nome) => { readFileSync(join(aqui, 'img', `${nome}.jpg`)); return `@img/${nome}` } // confere que o arquivo existe; o ambiente troca `@img/<nome>` pelo endereço do ativo

// ---- o tema: paleta quente (terracota, linho, carvão) do template, claro e escuro; títulos em serifa --------------------------------------
const tema = {
  kind: 'tema', id: 'maison', versao: '1.0.0', estatuto: 'publicado',
  spec: {
    fontes: ['cormorant-garamond', 'inter'], // embutidas na plataforma e servidas da própria origem (docs/temas.md)
    seguirSistema: false, // sempre claro, como o template; o escuro só com data-modo="escuro"
    tokens: {
      cor: {
        primaria: '#9f5a3c', primariaHover: '#7f4830', primariaClara: '#f3ece2', secundaria: '#2a2622', destaque: '#c07859',
        fundo: '#faf8f5', superficie: '#f6f4ee', superficieAlt: '#f2eee9', borda: '#e5e0dc', texto: '#2a2622', textoSuave: '#6c645c',
        sucesso: '#37704a', alerta: '#8a5a10', erro: '#b42323', textoSobrePrimaria: '#ffffff',
      },
      raio: { pequeno: 0, grande: 4 },
      espacamento: { base: '0.5rem', borda: 1 },
      tipografia: { familia: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", familiaTitulo: "'Cormorant Garamond', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif", pesoTitulo: 500, tamanhoBase: '16px', tamanhoH1: 'clamp(2.75rem, 6.5vw, 5rem)', tamanhoExibicao: 'clamp(3rem, 8.5vw, 8rem)', tamanhoGrande: 'clamp(2.5rem, 5vw, 3.75rem)', alturaExibicao: 0.9, espacamentoExibicao: '-0.025em', tamanhoH2: 'clamp(2rem, 4vw, 3rem)', tamanhoH3: 'clamp(1.5rem, 2.4vw, 1.875rem)', alturaTitulo: 1, espacamentoTitulo: '-0.025em', alturaCorpo: 1.625, tamanhoSobretitulo: '0.6875rem', espacamentoSobretitulo: '0.3em', margemSobretitulo: '1rem' },
      layout: { largura: '100rem', larguraEstreita: '64rem', larguraLarga: '100rem', recuo: '3rem', recuoEstreito: '1.5rem' }, // o contêiner do template (container-full 1600 px, recuo de 48; container-narrow 1024 px, recuo de 24)
      // cabeçalho translúcido com desfoque, que a capa da home atravessa por baixo; links pequenos em caixa alta com sublinhado que cresce
      cabecalho: { altura: 'clamp(4rem, 8vw, 5rem)', recuoX: 'max(3rem, calc((100% - 100rem) / 2 + 3rem))', fundo: 'color-mix(in srgb, var(--cor-fundo) 80%, transparent)', desfoque: 'blur(4px)', borda: 'transparent', marcaTamanho: 'clamp(1.5rem, 2.4vw, 1.875rem)', marcaFamilia: 'var(--tipografia-familia-titulo)', marcaPeso: 500, marcaEspacamento: '-0.025em', marcaHover: 'var(--cor-primaria)', linkTamanho: '0.75rem', linkEspacamento: '0.15em', linkCaixa: 'uppercase', linkCor: 'var(--cor-texto-suave)', linkHover: 'var(--cor-texto)', sublinhaHover: 1, linkPeso: 500, linkAtualCor: 'var(--cor-texto-suave)', linkAtualPeso: 500, linkAtualDecoracao: 'none', iconeCor: 'var(--cor-texto)', iconeHover: 'var(--cor-superficie-alt)', gatilhoAltura: '2.5rem', gatilhoRecuoX: '1rem', gatilhoFundo: 'color-mix(in srgb, var(--cor-superficie-alt) 50%, transparent)', submenuHover: 'grid', submenuDisplay: 'grid', submenuColunas: 2, submenuGap: '0.25rem', submenuLargura: '37.5rem', submenuRecuo: '1rem', submenuFundo: 'var(--cor-fundo)', submenuBorda: 'var(--cor-borda)', submenuSombra: '0 10px 30px color-mix(in srgb, var(--cor-texto) 8%, transparent)', submenuRaio: 0, submenuItem: '0.75rem', submenuItemHover: 'var(--cor-superficie-alt)' }, // o painel das coleções abre no hover: 2 colunas, cada item com título e descrição
      // rodapé invertido: fundo escuro no claro e claro no escuro
      rodape: { fundo: 'var(--cor-texto)', texto: 'var(--cor-fundo)', suave: 'color-mix(in srgb, var(--cor-fundo) 50%, transparent)', link: 'color-mix(in srgb, var(--cor-fundo) 60%, transparent)', borda: 'transparent', marcaTamanho: 'clamp(1.875rem, 3vw, 2.25rem)', marcaPeso: 400, marcaEspacamento: '-0.025em', descricaoTamanho: '0.875rem', tituloTamanho: '0.6875rem', tituloPeso: 600, tituloEspacamento: '0.25em', tituloCaixa: 'uppercase' },
      // transições do template: cor 300 ms, sublinhado 500 ms, foto do cartão 700 ms a 105%, entrada da capa 1,2 s e zoom lento de 20 s a 108%
      botao: { caixa: 'uppercase', espacamento: '0.1em', tamanho: '0.8125rem', peso: 500 },
      // a barra de categorias da loja: fixa sob o cabeçalho, translúcida com desfoque, abas em caixa alta (a escolhida invertida) e o seletor de ordem à direita
      abas: { gap: '0.5rem', altura: '2.25rem', recuoX: '1.25rem', recuoY: 0, tamanho: '0.75rem', peso: 500, espacamento: '0.1em', caixa: 'uppercase', cor: 'var(--cor-texto)', corHover: 'var(--cor-texto)', fundoHover: 'var(--cor-superficie-alt)', corAtiva: 'var(--cor-fundo)', fundoAtiva: 'var(--cor-texto)' },
      barra: { fundo: 'color-mix(in srgb, var(--cor-fundo) 95%, transparent)', desfoque: 'blur(12px)', recuoX: 'max(3rem, calc((100% - 100rem) / 2 + 3rem))', recuoY: '1.25rem', gap: '1rem', rotuloTamanho: '0.75rem', rotuloEspacamento: '0.1em', rotuloCaixa: 'uppercase', rotuloCor: 'var(--cor-texto-suave)' },
      selecao: { largura: '11.25rem', altura: '2.25rem', tamanho: '0.75rem', espacamento: '0.05em', fundo: 'var(--cor-fundo)' },
      cartao: { tituloTamanho: '1.25rem', tituloAltura: 1.375, tituloEspacamento: '-0.025em', tituloHover: 'var(--cor-primaria)', descricaoTamanho: '0.875rem', precoTamanho: '1rem', precoPeso: 500, precoEspacamento: '0.025em' },
      movimento: { rapido: '300ms', sublinha: '500ms', zoomDuracao: '1s', zoomCartao: 1.05, fotoAlt: '1s', rotulo: '500ms', zoomFaixa: 1.1, zoomFaixaDuracao: '1.2s', faixaVeu: 'color-mix(in srgb, var(--cor-texto) 20%, transparent)', faixaVeuDuracao: '700ms', faixaTexto: '500ms', faixaElevacao: '-0.25rem', entrada: '1.2s', zoomCapa: 1.08 },
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
// OS TEXTOS NÃO ESTÃO AQUI: as páginas só levam chaves de tradução (`T('home.titulo')` → `{t("home.titulo")}`); os textos de cada idioma vivem em idiomas.mjs
// e saem como o catálogo `maison.textos` (kind traducao). Trocar ou acrescentar um idioma não mexe em nenhuma página (docs/i18n.md).
const tx = (k, params) => `t("${k}"${params ? `, objeto([${Object.entries(params).map(([n, e]) => `["${n}", ${e}]`).join(', ')}])` : ''})` // um trecho de expressão
const T = (k, params) => `{${tx(k, params)}}` // um template (o valor inteiro da prop)
// um caminho interno no idioma da requisição: `tenant.prefixo` é "" no padrão e "/en" nos demais (docs/i18n.md); aceita um trecho de expressão entre chaves
const H = (caminho) => (caminho === '/' ? '{(tenant.prefixo ?? "") == "" ? "/" : tenant.prefixo}' : caminho.startsWith('{') ? `{(tenant.prefixo ?? "") + ${caminho.slice(1, -1)}}` : `{(tenant.prefixo ?? "") + ${JSON.stringify(caminho)}}`)
const b = (bloco, props, filhos, extra = {}) => ({ bloco, ...(props ? { props } : {}), ...(filhos ? { slots: { filhos } } : {}), ...extra })
const titulo = (texto, nivel, tamanho) => b('texto/titulo', { texto, nivel, ...(tamanho ? { tamanho } : {}) })
// título em duas partes: a segunda em itálico, numa linha própria (a capa do template: "Objects of / Quiet Beauty")
const tituloEnfase = (inicio, enfase, nivel) => b('texto/titulo', { texto: '', nivel }, [b('texto/trecho', { texto: inicio }), b('texto/enfase', { texto: enfase, bloco: true })])
const par = (texto) => b('texto/paragrafo', { texto })
const sobre = (texto) => b('texto/sobretitulo', { texto })
const contido = (filhos, largura, extra = {}) => b('layout/contido', largura ? { largura } : undefined, filhos, extra)
const folga = (tamanho) => b('layout/espacador', { tamanho })

const COLECOES = [
  { slug: 'iluminacao', foto: 'colecao-iluminacao' }, { slug: 'ceramica', foto: 'colecao-ceramica' }, { slug: 'mobiliario', foto: 'colecao-3' },
  { slug: 'texteis', foto: 'colecao-4' }, { slug: 'objetos', foto: 'colecao-5' }, { slug: 'sazonal', foto: 'colecao-6' },
]
// as 8 categorias do filtro da loja (as 6 coleções + novidades e presentes); o nome vem do dicionário (`colecao.<slug>.nome`)
const CATEGORIAS = [...COLECOES.map((c) => c.slug), 'novidades', 'presentes']
// os 13 produtos do template, na ordem do filtro "Destaques": só o que não é texto (o nome, a descrição e o material vêm do dicionário em vários idiomas)
const PRODUTOS = [
  { id: 'arco', colecao: 'iluminacao', preco: '485.00', foto: 'produto-1', selo: 'destaque' },
  { id: 'vaso', colecao: 'ceramica', preco: '320.00', foto: 'colecao-ceramica', selo: 'destaque' },
  { id: 'mesa', colecao: 'mobiliario', preco: '2850.00', foto: 'colecao-3', selo: 'destaque' },
  { id: 'castical', colecao: 'objetos', preco: '245.00', foto: 'produto-vela-castical', selo: 'destaque' },
  { id: 'orbe', colecao: 'iluminacao', preco: '295.00', foto: 'produto-2', selo: 'novo' },
  { id: 'tigela', colecao: 'ceramica', preco: '145.00', foto: 'produto-3' },
  { id: 'poltrona', colecao: 'mobiliario', preco: '1450.00', foto: 'produto-poltrona', selo: 'novo' },
  { id: 'manta', colecao: 'texteis', preco: '195.00', foto: 'colecao-4' },
  { id: 'almofada', colecao: 'texteis', preco: '165.00', foto: 'produto-almofada' },
  { id: 'vasinho', colecao: 'objetos', preco: '85.00', foto: 'colecao-5' },
  { id: 'vela', colecao: 'sazonal', preco: '65.00', foto: 'colecao-6' },
  { id: 'bandeja', colecao: 'novidades', preco: '175.00', foto: 'foto-3', selo: 'novo' },
  { id: 'caixa', colecao: 'presentes', preco: '225.00', foto: 'produto-caixa-presente' },
]
const FOTOS_HOVER = ['sobre-1', 'foto-1', 'foto-2', 'loja-capa', 'hero', 'sobre-2', 'colecao-iluminacao', 'sobre-capa'] // a segunda foto de cada peça (aparece no hover): cenas da casa, em ciclo
// o dado do produto como um catálogo o traria: o texto em vários idiomas ({ 'pt-BR': …, en: … }); a página escolhe com `loc(idioma, …)`
const dadosProduto = (p, i) => ({
  id: p.id, colecao: p.colecao, preco: p.preco, fotoUrl: foto(p.foto), fotoHover: foto(FOTOS_HOVER[i % FOTOS_HOVER.length]), disponivel: true,
  nome: doDicionario(`produto.${p.id}.nome`), descricao: doDicionario(`produto.${p.id}.descricao`), material: doDicionario(`produto.${p.id}.material`),
  categoria: doDicionario(`colecao.${p.colecao}.nome`), selo: p.selo ? doDicionario(`selo.${p.selo}`) : { 'pt-BR': '', en: '' }, novo: p.selo === 'novo',
})
// o hero da loja DEPENDE da categoria escolhida (`?colecao=<slug>`): cada categoria tem foto, nome e frase próprios; sem categoria, o hero "Todas as peças"
const HEROIS = [['iluminacao', 'loja-capa-iluminacao'], ['ceramica', 'colecao-ceramica'], ['mobiliario', 'colecao-3'], ['texteis', 'colecao-4'], ['objetos', 'colecao-5'], ['sazonal', 'colecao-6'], ['novidades', 'foto-3'], ['presentes', 'produto-2']]
const estadoColecoes = { colecoes: { tipo: 'json', lista: true, inicial: HEROIS.map(([slug, f]) => ({ slug, foto: foto(f), nome: doDicionario(`colecao.${slug}.nome`), frase: doDicionario(`colecao.${slug}.frase`) })) } }
const FOTOS = ['hero', 'foto-1', 'foto-2', 'foto-3', 'colecao-ceramica', 'colecao-5']
const estadoProdutos = { produtos: { tipo: 'json', lista: true, inicial: PRODUTOS.map(dadosProduto) } }
// a lista de produtos NO IDIOMA DA REQUISIÇÃO: cada campo de texto passa por `loc(idioma, …)`
const LOC = 'mapeia(estado.produtos, p => mescla(p, objeto([["nome", loc(idioma, p.nome)], ["descricao", loc(idioma, p.descricao)], ["material", loc(idioma, p.material)], ["categoria", loc(idioma, p.categoria)], ["selo", loc(idioma, p.selo)]])))'

// ---- a sacola: estado que PERSISTE no navegador (id e quantidade); o preço vem sempre do catálogo, nunca do que foi guardado -------------------------------
const estadoSacola = { sacola: { tipo: 'json', lista: true, inicial: [], persiste: true } }
const QTD_TOTAL = 'soma(mapeia(estado.sacola, i => i.qtd))'
const adiciona = (id) => `acha(estado.sacola, i => i.id == ${id}) ? mapeia(estado.sacola, i => i.id == ${id} ? com(i, ["qtd"], i.qtd + 1) : i) : concat(estado.sacola, [objeto([["id", ${id}], ["qtd", 1]])])`
const muda = (id, delta) => `filtra(mapeia(estado.sacola, i => i.id == ${id} ? com(i, ["qtd"], i.qtd + ${delta}) : i), i => i.qtd > 0)`
const tira = (id) => `filtra(estado.sacola, i => i.id != ${id})`
const aoClicar = (valor) => ({ aoClicar: [{ acao: 'definir', estado: 'sacola', valor }] })
// as linhas da sacola com o produto do catálogo (item sem produto some), o total de cada uma e o subtotal (dinheiro exato)
const LINHAS = `filtra(mapeia(estado.sacola, i => objeto([["id", i.id], ["qtd", i.qtd], ["p", acha(${LOC}, p => p.id == i.id)]])), l => l.p != null)`
const SUBTOTAL = `dobra(${LINHAS}, "0", (acc, l) => qsoma(acc, qmul(l.p.preco, l.qtd)))`
const ROTULOS_RESUMO = { subtotal: T('resumo.subtotal'), total: T('resumo.total') }

// ---- as partes comuns: cabeçalho (com o seletor de idioma) e rodapé -----------------------------------------------------------------------------
const OUTROS_IDIOMAS = 'filtra(tenant.idiomas ?? [], i => !i.atual)'
const SACOLA_TOTAL = QTD_TOTAL
const cabecalho = (atual) => b('site/cabecalho', {
  titulo: 'Maison', fixo: true, menuCentro: true, href: H('/'), gruposAntes: true,
  links: [{ texto: T('nav.loja'), href: H('/produtos'), ...(atual === 'loja' ? { atual: true } : {}) }, { texto: T('nav.sobre'), href: H('/sobre'), ...(atual === 'sobre' ? { atual: true } : {}) }],
  // o menu "Coleções": abre no hover num painel de 2 colunas, cada coleção com o nome e a frase
  grupos: [{ titulo: T('nav.colecoes'), links: CATEGORIAS.map((slug) => ({ texto: T(`colecao.${slug}.nome`), descricao: T(`colecao.${slug}.frase`), href: H(`/produtos?colecao=${slug}`) })) }],
}, undefined, { slots: { acoes: [
  // o seletor: um link para cada OUTRO idioma do tenant (a mesma página, no outro idioma); some quando o tenant tem um idioma só
  { bloco: 'nav/link', repetir: { cada: OUTROS_IDIOMAS, como: 'i', chave: 'i.idioma' }, props: { href: '{i.href}', texto: '{i.idioma == "en" ? ' + tx('idioma.curto.en') + ' : ' + tx('idioma.curto.pt-BR') + '}' } },
  // a sacola é um ícone com o contador (só aparece com itens); o nome acessível leva a contagem
  b('nav/link', { href: H('/sacola'), icone: 'sacola', rotulo: T('nav.sacola', { n: SACOLA_TOTAL }) }, [b('texto/pequeno', { texto: `{${SACOLA_TOTAL}}` }, undefined, { se: `${SACOLA_TOTAL} > 0` })]),
] } })
const rodape = () => b('site/rodape', {
  marca: 'Maison', descricao: T('rodape.descricao'),
  colunas: [
    { titulo: T('rodape.loja'), links: [{ texto: T('rodape.todas'), href: H('/produtos') }, { texto: T('rodape.novidades'), href: H('/produtos?colecao=novidades') }, { texto: T('rodape.presentes'), href: H('/produtos?colecao=presentes') }] },
    { titulo: T('rodape.casa'), links: [{ texto: T('rodape.historia'), href: H('/sobre') }, { texto: T('rodape.sacola'), href: H('/sacola') }, { texto: T('rodape.contato'), href: H('/sobre#contato') }] },
  ],
  copyright: T('rodape.copyright'),
})
const link = (href, texto, botao) => b('nav/link', { href: H(href), texto, ...(botao ? { botao } : {}) })
// as props de um cartão de produto: o template passa os rótulos e o idioma (o bloco não tem texto fixo que o template não possa trocar)
const propsCartao = (produto, href) => ({ fluida: true, proporcao: 0.8, produto, href, rotuloLink: '', rotuloFoto: T('produto.verDetalhes'), mostraDescricao: true, idioma: '{idioma}' })

// ---- início ---------------------------------------------------------------------------------------------------------------------------------
const NOVIDADES = `mapeia(["arco", "orbe", "vaso", "tigela"], id => acha(${LOC}, q => q.id == id))`
const home = b('layout/pilha', { gap: 0 }, [
  cabecalho(),
  // abertura em tela quase cheia, com a foto e o véu escuro; o texto alinha com o resto da página
  b('layout/destaque', { imagem: foto('hero'), altura: 800, escurece: 0.3, alinha: 'esquerda', capa: true }, [
    contido([
      sobre(T('home.eyebrow')),
      tituloEnfase(T('home.titulo1'), T('home.titulo2'), 1),
      par(T('home.texto')),
      link('/produtos', T('home.cta'), 'primario'),
    ]),
    b('layout/pilha', { marca: 'indicador-capa' }, [b('texto/pequeno', { texto: T('home.rolar') })]),
  ]),
  folga(112),
  // coleção em destaque: foto à esquerda, texto à direita, centrado na vertical
  contido([
    b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
      b('midia/imagem', { src: foto(COLECOES[0].foto), alt: T('colecao.iluminacao.nome'), fluida: true, proporcao: 0.8 }),
      b('layout/pilha', { gap: 0, alinha: 'inicio' }, [
        sobre(T('home.destaque.eyebrow')),
        titulo(T('colecao.iluminacao.nome'), 2, 'grande'), folga(16),
        par(T('home.destaque.texto')), folga(24),
        link(`/produtos?colecao=${COLECOES[0].slug}`, T('home.destaque.cta'), 'primario'),
      ]),
    ]),
  ]),
  folga(112),
  // novidades sobre o fundo de linho
  b('layout/destaque', { fundo: 'suave', altura: 120, alinha: 'esquerda' }, [
    contido([
      b('layout/linha', { gap: 16, alinha: 'fim', quebra: true }, [
        b('layout/pilha', { gap: 4, cresce: true }, [sobre(T('home.novidades.eyebrow')), titulo(T('home.novidades.titulo'), 2)]),
        link('/produtos', T('home.verTudo')),
      ]),
      folga(24),
      b('layout/grade', { colunas: 4, gap: 32 }, [{ bloco: 'commerce/cartao-produto', props: propsCartao('{p}', H('{"/produtos/" + p.id}')), repetir: { cada: NOVIDADES, como: 'p', chave: 'p.id' } }]),
    ]),
  ]),
  folga(112),
  // explore por coleção
  contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre(T('home.colecoes.eyebrow')), titulo(T('home.colecoes.titulo'), 2)]),
    folga(32),
    b('layout/grade', { colunas: 3, gap: 24 }, COLECOES.map((c) => b('layout/destaque', { imagem: foto(c.foto), altura: 360, escurece: 0.4, alinha: 'esquerda', zoom: true }, [titulo(T(`colecao.${c.slug}.nome`), 3), par(T(`colecao.${c.slug}.frase`)), link(`/produtos?colecao=${c.slug}`, T('home.colecoes.cta'))]))),
  ], 'larga', { id: 'colecoes' }),
  folga(112),
  // a faixa de fotos
  contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre(T('home.instagram.eyebrow')), titulo('@maisonhome', 2), par(T('home.instagram.texto'))]),
    folga(24),
    b('layout/grade', { colunas: 6, gap: 8 }, FOTOS.map((f, i) => b('layout/pilha', { recorta: true }, [b('midia/imagem', { src: foto(f), alt: T('home.foto.alt', { n: i + 1 }), fluida: true, proporcao: 1 })]))),
  ], 'larga'),
  folga(112),
  rodape(),
])

// a categoria do hero (0 ou 1 item): nome e frase no idioma da requisição
const HERO_DA_CATEGORIA = 'filtra(mapeia(estado.colecoes, c => mescla(c, objeto([["nome", loc(idioma, c.nome)], ["frase", loc(idioma, c.frase)]]))), c => c.slug == (estado.colecao ?? ""))'
// ---- produtos: filtro por categoria (?colecao=…), contagem e grade com selos --------------------------------------------------------------
const FILTRADOS = `filtra(${LOC}, p => (estado.colecao ?? "") == "" || p.colecao == estado.colecao)`
// a ordem escolhida no seletor (estado `ordem`): cinco critérios, como no template (preço em dinheiro exato → número só para comparar)
const ORDENADOS = `(estado.ordem == "preco" ? ordena(${FILTRADOS}, x => qnum(x.preco)) : estado.ordem == "preco-desc" ? inverte(ordena(${FILTRADOS}, x => qnum(x.preco))) : estado.ordem == "nome" ? ordena(${FILTRADOS}, x => semAcentos(minusculas(x.nome))) : estado.ordem == "novidades" ? ordena(${FILTRADOS}, x => x.novo ? 0 : 1) : ${FILTRADOS})`
const ORDENS = [['destaque', 'ordem.destaque'], ['novidades', 'ordem.novidades'], ['preco', 'ordem.precoAsc'], ['preco-desc', 'ordem.precoDesc'], ['nome', 'ordem.nome']]
const aba = (slug, texto) => ({ texto, href: H(slug ? `/produtos?colecao=${slug}` : '/produtos'), soConsulta: true, atual: `{(estado.colecao ?? "") == ${JSON.stringify(slug)}}` }) // a categoria escolhida leva aria-current e fica preenchida
// a barra de categorias: `site/abas` (as categorias) e o seletor de ordem, numa faixa fixa sob o cabeçalho
const barraCategorias = b('layout/linha', { marca: 'barra-fixa' }, [
  b('site/abas', { rotulo: T('loja.categorias'), itens: [aba('', T('loja.todas')), ...CATEGORIAS.map((slug) => aba(slug, T(`colecao.${slug}.nome`)))] }),
  b('layout/linha', { marca: 'ordenar', gap: 12, alinha: 'centro' }, [
    b('texto/rotulo', { texto: T('loja.ordenar'), para: 'ordem' }),
    b('entrada/selecao', { valor: '{estado.ordem}' }, ORDENS.map(([v, k]) => b('entrada/opcao', { valor: v, texto: T(k), selecionada: `{estado.ordem == "${v}"}` })), { id: 'ordem', eventos: { aoMudar: [{ acao: 'definir', estado: 'ordem', valor: 'evento' }] } }),
  ]),
])
const cartao = { bloco: 'commerce/cartao-produto', props: propsCartao('{p}', H('{"/produtos/" + p.id}')), repetir: { cada: ORDENADOS, como: 'p', chave: 'p.id' }, slots: { acoes: [
  { bloco: 'texto/pequeno', props: { texto: '{p.material}' } }, // o selo (Destaque, Novo) vai sobre a foto; aqui só o material
  { bloco: 'nav/botao', props: { texto: T('produto.adicionar'), variante: 'secundario' }, eventos: aoClicar(adiciona('p.id')) },
] } }
const produtos = b('layout/pilha', { gap: 0 }, [
  cabecalho('loja'),
  // o hero muda com a categoria ativa: com categoria (foto, nome e frase dela); sem categoria, "Todas as peças"
  { ...b('layout/destaque', { imagem: '{c.foto}', altura: 510, escurece: 0.35, alinha: 'esquerda', capa: true }, [contido([sobre(T('loja.colecao')), titulo('{c.nome}', 1), par('{c.frase}')])]), repetir: { cada: HERO_DA_CATEGORIA, como: 'c', chave: 'c.slug' } },
  b('layout/destaque', { imagem: foto('loja-capa'), altura: 510, escurece: 0.35, alinha: 'esquerda', capa: true }, [contido([sobre(T('loja.eyebrow')), titulo(T('loja.titulo'), 1)])], { se: `tamanho(${HERO_DA_CATEGORIA}) == 0` }),
  barraCategorias,
  folga(32),
  contido([
    b('texto/pequeno', { texto: T('loja.contagem', { n: `tamanho(${FILTRADOS})` }) }),
    folga(16),
    b('layout/grade', { colunas: 4, gap: 32 }, [cartao]),
    b('texto/paragrafo', { texto: T('loja.vazio') }, undefined, { se: `tamanho(${FILTRADOS}) == 0` }),
  ], 'larga'),
  folga(112),
  rodape(),
])

// ---- sobre ----------------------------------------------------------------------------------------------------------------------------------
const sobre_ = b('layout/pilha', { gap: 0 }, [
  cabecalho('sobre'),
  b('layout/destaque', { imagem: foto('sobre-capa'), altura: 560, escurece: 0.4, alinha: 'esquerda', capa: true }, [contido([
    sobre(T('sobre.eyebrow')), tituloEnfase(T('sobre.h1a'), T('sobre.h1b'), 1),
    par(T('sobre.capa.texto')),
  ])]),
  folga(112),
  contido([sobre(T('sobre.filosofia.eyebrow')), par(T('sobre.filosofia.texto'))], 'estreita'),
  folga(112),
  contido([b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      sobre(T('sobre.comeco.eyebrow')), titulo(T('sobre.comeco.titulo'), 2),
      par(T('sobre.comeco.p1')),
      par(T('sobre.comeco.p2')),
    ]),
    b('midia/imagem', { src: foto('sobre-1'), alt: T('sobre.comeco.alt'), fluida: true, proporcao: 0.8 }),
  ])]),
  folga(112),
  contido([titulo(T('sobre.citacao'), 3)], 'estreita'),
  folga(112),
  contido([b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
    b('midia/imagem', { src: foto('sobre-2'), alt: T('sobre.abordagem.alt'), fluida: true, proporcao: 0.8 }),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      sobre(T('sobre.abordagem.eyebrow')), titulo(T('sobre.abordagem.titulo'), 2),
      par(T('sobre.abordagem.p1')),
      par(T('sobre.abordagem.p2')),
    ]),
  ])]),
  folga(112),
  b('layout/destaque', { fundo: 'suave', altura: 120, alinha: 'esquerda' }, [contido([
    b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre(T('sobre.valores.eyebrow')), titulo(T('sobre.valores.titulo'), 2)]),
    folga(32),
    b('layout/grade', { colunas: 3, gap: 48 }, [1, 2, 3].map((n) => b('layout/pilha', { gap: 8, alinha: 'inicio' }, [sobre(`0${n}`), titulo(T(`sobre.valor${n}.titulo`), 3), par(T(`sobre.valor${n}.texto`))]))),
  ])]),
  folga(112),
  contido([b('layout/grade', { colunas: 3, gap: 24 }, ['colecao-ceramica', 'colecao-4', 'produto-almofada'].map((f, i) => b('layout/pilha', { recorta: true }, [b('midia/imagem', { src: foto(f), alt: T('sobre.detalhe.alt', { n: i + 1 }), fluida: true, proporcao: 0.8 })])))], 'larga'),
  folga(112),
  b('layout/destaque', { imagem: foto('foto-2'), altura: 420, escurece: 0.45, alinha: 'centro' }, [
    sobre(T('sobre.contato.eyebrow')), titulo(T('sobre.contato.titulo'), 2),
    par(T('sobre.contato.texto')),
    link('/produtos', T('home.cta'), 'primario'),
  ], { id: 'contato' }),
  rodape(),
])

// ---- detalhe do produto: /produtos/:id (foto, dados, adicionar à sacola e outras peças da mesma coleção) -----------------------------------------------
const ACHADO = `filtra(${LOC}, p => p.id == params.id)`
const MESMA = `fatia(filtra(${LOC}, o => o.colecao == p.colecao && o.id != p.id), 0, 4)`
const detalhe = b('layout/pilha', { gap: 0 }, [
  cabecalho('loja'),
  folga(48),
  { ...b('layout/pilha', { gap: 0 }, [
    contido([
      link('/produtos', T('produto.voltar')),
      folga(24),
      b('layout/grade', { colunas: 2, gap: 64, alinha: 'centro' }, [
        b('midia/imagem', { src: '{p.fotoUrl}', alt: '{p.nome}', fluida: true, proporcao: 0.8 }),
        b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
          sobre('{p.categoria}'),
          titulo('{p.nome}', 1),
          b('commerce/preco', { valor: '{p.preco}', idioma: '{idioma}' }),
          par('{p.descricao}'),
          b('texto/pequeno', { texto: T('produto.material', { material: 'p.material' }) }),
          b('texto/pequeno', { texto: T('produto.nota') }),
          folga(8),
          b('layout/linha', { gap: 12, quebra: true }, [
            b('nav/botao', { texto: T('produto.adicionar') }, undefined, { eventos: aoClicar(adiciona('p.id')) }),
            link('/sacola', T('produto.verSacola')),
          ]),
        ]),
      ]),
    ], 'larga'),
    folga(112),
    contido([
      b('layout/pilha', { gap: 8, alinha: 'centro' }, [sobre(T('produto.mesmaColecao')), titulo(T('produto.tambem'), 2)]),
      folga(32),
      b('layout/grade', { colunas: 4, gap: 32 }, [{ bloco: 'commerce/cartao-produto', props: propsCartao('{o}', H('{"/produtos/" + o.id}')), repetir: { cada: MESMA, como: 'o', chave: 'o.id' } }]),
    ], 'larga', { se: `tamanho(${MESMA}) > 0` }),
  ]), repetir: { cada: ACHADO, como: 'p', chave: 'p.id' } },
  contido([
    sobre(T('produto.naoAchada.eyebrow')), titulo(T('produto.naoAchada.titulo'), 2), par(T('produto.naoAchada.texto')), link('/produtos', T('produto.verTodas'), 'primario'),
  ], 'estreita', { se: `tamanho(${ACHADO}) == 0` }),
  folga(112),
  rodape(),
])

// ---- checkout de DEMONSTRAÇÃO: o formulário valida no navegador (sem `envio`, a ilha só avisa a página com os valores) e o pedido é gravado
// no estado persistente `pedidos`, neste navegador. Não há pagamento, frete nem servidor: o serviço `pedidos` exige comprador autenticado (docs/commerce.md).
const estadoPedidos = { pedidos: { tipo: 'json', lista: true, inicial: [], persiste: true } }
// os rótulos do formulário são multilíngues pelo próprio formato do kind formulario: { 'pt-BR': …, en: … }, vindos do mesmo dicionário
const formulario = { kind: 'formulario', id: 'maison.checkout', versao: '1.0.0', estatuto: 'publicado', spec: {
  titulo: doDicionario('checkout.form.titulo'),
  campos: [
    { nome: 'nome', tipo: 'texto', rotulo: doDicionario('checkout.form.nome'), obrigatorio: true, autocompletar: 'name' },
    { nome: 'email', tipo: 'email', rotulo: doDicionario('checkout.form.email'), obrigatorio: true },
    { nome: 'telefone', tipo: 'telefone', rotulo: doDicionario('checkout.form.telefone'), obrigatorio: true },
    { nome: 'cep', tipo: 'cep', rotulo: doDicionario('checkout.form.cep'), obrigatorio: true },
    { nome: 'endereco', tipo: 'texto', rotulo: doDicionario('checkout.form.endereco'), obrigatorio: true },
    { nome: 'cidade', tipo: 'texto', rotulo: doDicionario('checkout.form.cidade'), obrigatorio: true },
  ],
  acoes: [{ id: 'enviar', rotulo: doDicionario('checkout.form.enviar'), tipo: 'enviar', estilo: 'primario' }],
} }
const PEDIDO = `objeto([["numero", 1001 + tamanho(estado.pedidos)], ["cliente", evento.valores], ["itens", mapeia(${LINHAS}, l => objeto([["nome", l.p.nome], ["qtd", l.qtd], ["total", qmul(l.p.preco, l.qtd)]]))], ["total", ${SUBTOTAL}]])`
const resumoLinha = b('layout/linha', { gap: 12, alinha: 'centro', quebra: true }, [
  b('midia/imagem', { src: '{l.p.fotoUrl}', alt: '{l.p.nome}', proporcao: 0.8, largura: 56 }),
  b('layout/pilha', { gap: 2, cresce: true, alinha: 'inicio' }, [b('texto/rotulo', { texto: '{l.p.nome}' }), b('texto/pequeno', { texto: '{l.qtd + " × " + qmoeda(l.p.preco, idioma)}' })]),
  b('texto/rotulo', { texto: '{qmoeda(qmul(l.p.preco, l.qtd), idioma)}' }),
])
const checkout = b('layout/pilha', { gap: 0 }, [
  cabecalho(),
  folga(64),
  contido([
    sobre(T('checkout.eyebrow')), titulo(T('checkout.h1'), 1), folga(24),
    b('layout/grade', { colunas: 2, gap: 64 }, [
      b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
        b('form/formulario', { formulario: 'maison.checkout', idioma: '{idioma}' }, undefined, { eventos: { aoEnviado: [
          { acao: 'definir', estado: 'pedidos', valor: `concat(estado.pedidos, [${PEDIDO}])` },
          { acao: 'definir', estado: 'sacola', valor: '[]' },
          { acao: 'navegar', para: H('/pedido') },
        ] } }),
        par(T('checkout.aviso')),
      ]),
      b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
        titulo(T('checkout.resumo'), 3),
        b('layout/pilha', { gap: 12 }, [{ ...resumoLinha, repetir: { cada: LINHAS, como: 'l', chave: 'l.id' } }]),
        b('commerce/resumo-pedido', { subtotal: `{${SUBTOTAL}}`, total: `{${SUBTOTAL}}`, idioma: '{idioma}', rotulos: ROTULOS_RESUMO }),
        link('/sacola', T('checkout.voltar')),
      ]),
    ], { se: `tamanho(${LINHAS}) > 0` }),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [titulo(T('sacola.vazia'), 3), par(T('checkout.vazia')), link('/produtos', T('home.cta'), 'primario')], { se: `tamanho(${LINHAS}) == 0` }),
  ], 'larga'),
  folga(112),
  rodape(),
])
// confirmação: o último pedido gravado neste navegador
const ULTIMO = 'ultimo(estado.pedidos)'
const confirmacao = b('layout/pilha', { gap: 0 }, [
  cabecalho(),
  folga(64),
  contido([
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      sobre(T('pedido.eyebrow')), titulo(T('pedido.obrigado', { nome: `aparar(${ULTIMO}.cliente.nome)` }), 1),
      par(T('pedido.resumo', { numero: `${ULTIMO}.numero`, total: `qmoeda(${ULTIMO}.total, idioma)`, email: `${ULTIMO}.cliente.email` })),
      b('layout/pilha', { gap: 8 }, [{ bloco: 'texto/rotulo', props: { texto: '{i.qtd + " × " + i.nome + " — " + qmoeda(i.total, idioma)}' }, repetir: { cada: ULTIMO + '.itens', como: 'i', chave: 'i.nome' } }]),
      par(T('pedido.demo')),
      link('/produtos', T('sacola.continuar'), 'primario'),
    ], { se: `tamanho(estado.pedidos) > 0` }),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [titulo(T('pedido.nenhum'), 2), link('/produtos', T('home.cta'), 'primario')], { se: `tamanho(estado.pedidos) == 0` }),
  ], 'estreita'),
  folga(112),
  rodape(),
])

// ---- sacola: linhas com foto, quantidade (− e +), remover, subtotal e o aviso de que o pagamento ainda não existe --------------------------------------
const linha = b('layout/linha', { gap: 24, alinha: 'centro', quebra: true }, [
  b('midia/imagem', { src: '{l.p.fotoUrl}', alt: '{l.p.nome}', proporcao: 0.8, largura: 96 }),
  b('layout/pilha', { gap: 4, cresce: true, alinha: 'inicio' }, [titulo('{l.p.nome}', 3), b('texto/pequeno', { texto: '{l.p.material}' }), b('texto/pequeno', { texto: '{qmoeda(l.p.preco, idioma)}' })]),
  b('layout/linha', { gap: 8, alinha: 'centro' }, [
    b('nav/botao', { texto: '−', variante: 'secundario' }, undefined, { eventos: aoClicar(muda('l.id', '-1')) }),
    b('texto/rotulo', { texto: '{l.qtd}' }),
    b('nav/botao', { texto: '+', variante: 'secundario' }, undefined, { eventos: aoClicar(muda('l.id', '1')) }),
  ]),
  b('texto/rotulo', { texto: '{qmoeda(qmul(l.p.preco, l.qtd), idioma)}' }),
  b('nav/botao', { texto: T('sacola.remover'), variante: 'secundario' }, undefined, { eventos: aoClicar(tira('l.id')) }),
])
const sacolaPag = b('layout/pilha', { gap: 0 }, [
  cabecalho('sacola'),
  folga(64),
  contido([
    sobre(T('sacola.eyebrow')), titulo(T('sacola.h1'), 1), folga(24),
    b('layout/pilha', { gap: 24 }, [{ ...linha, repetir: { cada: LINHAS, como: 'l', chave: 'l.id' } }]),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [titulo(T('sacola.vazia'), 3), par(T('sacola.vaziaTexto')), link('/produtos', T('home.cta'), 'primario')], { se: `tamanho(${LINHAS}) == 0` }),
    b('layout/pilha', { gap: 16, alinha: 'inicio' }, [
      folga(16),
      b('commerce/resumo-pedido', { subtotal: `{${SUBTOTAL}}`, total: `{${SUBTOTAL}}`, idioma: '{idioma}', rotulos: ROTULOS_RESUMO }),
      par(T('sacola.aviso')),
      link('/checkout', T('sacola.finalizar'), 'primario'),
      link('/produtos', T('sacola.continuar')),
    ], { se: `tamanho(${LINHAS}) > 0` }),
  ], 'estreita'),
  folga(112),
  rodape(),
])

// toda página usa o catálogo `maison.textos` (traducoes) e tem a sacola persistente
const pagina = (id, rota, titulo, raiz, extra = {}) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota, titulo, raiz, traducoes: ['maison.textos'], ...extra, estado: { ...estadoSacola, ...(extra.estado ?? {}) } } })
const naoAchada = b('layout/pilha', { gap: 16, alinha: 'centro' }, [titulo(T('nao.titulo'), 1), par(T('nao.texto')), link('/', T('nao.voltar'), 'primario')])
const PAGINAS = ['maison.home', 'maison.produtos', 'maison.produto', 'maison.sobre', 'maison.sacola', 'maison.checkout', 'maison.pedido', 'maison.nao']
const tenant = (id, tenantId, nome) => ({ kind: 'tenant', id, tenantId, versao: '1.0.0', estatuto: 'publicado', spec: { alias: id, nome, segmento: 'varejo', modulos: ['loja'], tema: 'maison', paginas: PAGINAS, paginaNaoEncontrada: 'maison.nao', idiomas: IDIOMAS, idiomaPadrao: PADRAO } })

const textos = { kind: 'traducao', id: 'maison.textos', versao: '1.0.0', estatuto: 'publicado', spec: { descricao: 'Textos da Maison em pt-BR (padrão) e en (o texto original do template)', padrao: PADRAO, mensagens: MENSAGENS } }

const nos = [
  tema,
  textos,
  formulario,
  pagina('maison.home', '/', 'Maison', home, { estado: estadoProdutos }),
  pagina('maison.produtos', '/produtos', T('loja.titulo') + ' · Maison', produtos, { estado: { ...estadoProdutos, ...estadoColecoes, ordem: { tipo: 'texto', inicial: 'destaque' }, colecao: { tipo: 'texto', inicial: '', daConsulta: 'colecao' } } }),
  pagina('maison.produto', '/produtos/:id', T('produto.titulo'), detalhe, { params: { id: { tipo: 'texto' } }, estado: estadoProdutos }),
  pagina('maison.sobre', '/sobre', T('sobre.titulo'), sobre_),
  pagina('maison.sacola', '/sacola', T('sacola.titulo'), sacolaPag, { estado: estadoProdutos }),
  pagina('maison.checkout', '/checkout', T('checkout.titulo'), checkout, { estado: { ...estadoPedidos, ...estadoProdutos } }),
  pagina('maison.pedido', '/pedido', T('pedido.titulo'), confirmacao, { estado: estadoPedidos }),
  pagina('maison.nao', '/nao-encontrada', T('nao.titulo'), naoAchada),
  tenant('loja-demo', '11111111-1111-1111-1111-111111111111', 'Loja Demo'),
  tenant('loja-outra', '22222222-2222-2222-2222-222222222222', 'Outra Loja'),
]
writeFileSync(join(aqui, 'nos.json'), `${JSON.stringify(nos, null, 2)}\n`)
console.log(`exemplos/maison/nos.json: ${nos.length} nós (tema, ${nos.filter((n) => n.kind === 'pagina').length} páginas, ${nos.filter((n) => n.kind === 'tenant').length} tenants, catálogo ${IDIOMAS.join('+')} com ${Object.keys(MENSAGENS[PADRAO]).length} chaves)`)
