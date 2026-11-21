import type { Registry } from '@polaris/schema'

// Blocos do SITE, 100% declarativos (kind `bloco` com `modelo` sobre os blocos base): nenhum código novo no runtime, então herdam hidratação, streaming, tema e tree-shaking.
// O modelo não tem estado nem eventos (é função das props): o que depende da página (botão "Entrar", carrinho…) entra pelo slot `acoes`.

type Inst = { bloco: string; id?: string; props?: Record<string, unknown>; slots?: Record<string, Inst[]>; se?: string; repetir?: { cada: string; como: string; chave?: string } }
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec })
const instancia = (bloco: string, props: Record<string, unknown>, slots?: Record<string, Inst[]>): Inst => ({ bloco, props, ...(slots ? { slots } : {}) })

const linkProp = { type: 'object', properties: { texto: { type: 'string', maxLength: 80 }, href: { type: 'string', maxLength: 500 }, atual: { type: 'boolean', description: 'a página aberta (aria-current)' } }, required: ['texto', 'href'] }
const linkComDescricaoProp = { ...linkProp, properties: { ...linkProp.properties, descricao: { type: 'string', maxLength: 160, description: 'frase sob o título (nos submenus: o item vira título + descrição)' } } }
const colunaProp = { type: 'object', properties: { titulo: { type: 'string', maxLength: 80 }, links: { type: 'array', maxItems: 12, items: linkComDescricaoProp } }, required: ['titulo'] }

// os submenus do cabeçalho (`grupos`): cada item é um link de texto, ou, com `descricao`, um link com o título e a descrição embaixo
const GRUPOS_DO_MENU = (se: string) => ({ bloco: 'nav/submenu', se, repetir: { cada: 'props.grupos ?? []', como: 'g', chave: 'g.titulo' }, slots: { filhos: [
  { bloco: 'nav/submenu-titulo', props: { texto: '{g.titulo}' } },
  { bloco: 'nav/link', repetir: { cada: 'filtra(g.links ?? [], x => !x.descricao)', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}' } },
  { bloco: 'nav/link', repetir: { cada: 'filtra(g.links ?? [], x => x.descricao)', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', atual: '{l.atual == true}' }, slots: { filhos: [
    { bloco: 'texto/destaque', props: { texto: '{l.texto}' } }, { bloco: 'texto/pequeno', props: { texto: '{l.descricao}' } },
  ] } },
] } })
const BLOCOS_CABECALHO = [
  no('bloco', 'site.cabecalho', {
    interface: 'site/cabecalho', titulo: 'Cabeçalho do site',
    descricao: 'Topo da página: marca (logo e/ou nome, ligada ao início), menu de navegação (`links`, com `atual` na página aberta, e `grupos`: submenus recolhíveis, sem JavaScript) e o slot `acoes` à direita (ex.: botão de entrar ou carrinho). `fixo` o mantém no topo ao rolar. No celular o menu e as ações ficam atrás de um botão "Menu" (`nav/alternador`, sem JavaScript; `menuRecolhivel: false` desliga). Usa `<header>` e `<nav>` (pontos de referência para leitores de tela) e só variáveis do tema. Uma por página (o `id` do alternador é fixo).',
    props: { type: 'object', properties: {
      titulo: { type: 'string', maxLength: 80, description: 'nome da marca' }, logo: { type: 'string', maxLength: 500, description: 'URL segura da imagem da marca' },
      href: { type: 'string', maxLength: 500, default: '/', description: 'para onde a marca leva' }, links: { type: 'array', maxItems: 12, items: linkProp, description: 'o menu' }, grupos: { type: 'array', maxItems: 6, items: colunaProp, description: 'submenus: cada grupo (`titulo` e `links`) é um item recolhível que abre uma lista de links, depois dos `links`; um nível só' },
      rotuloMenu: { type: 'string', maxLength: 80, default: 'Principal' }, fixo: { type: 'boolean', default: false }, gruposAntes: { type: 'boolean', default: false, description: 'os submenus (`grupos`) vêm antes dos `links` no menu' }, menuCentro: { type: 'boolean', default: false, description: 'centraliza o menu entre a marca e as ações' },
      tituloNivel: { type: 'integer', minimum: 1, maximum: 6, description: 'faz do nome da marca um título (h1…h6) em vez de texto em destaque: use 1 em aplicações cujo painel não tem outro h1' }, menuRecolhivel: { type: 'boolean', default: true, description: 'no celular (até 40 rem de largura) o menu e as ações ficam atrás de um botão "Menu", sem JavaScript; false mantém tudo à vista' }, rotuloAlternador: { type: 'string', maxLength: 60, default: 'Abrir o menu' },
    } },
    slots: { acoes: {} },
    exemplos: [
      { titulo: 'Marca e menu', instancia: instancia('site/cabecalho', { titulo: 'Loja Demo', links: [{ texto: 'Início', href: '/', atual: true }, { texto: 'Produtos', href: '/produtos' }, { texto: 'Contato', href: '/contato' }] }) },
      { titulo: 'Com ação e fixo', instancia: instancia('site/cabecalho', { titulo: 'Loja Demo', fixo: true, links: [{ texto: 'Início', href: '/' }] }, { acoes: [{ bloco: 'nav/link', props: { href: '/entrar', texto: 'Entrar' } }] }) },
    ],
    modelo: { bloco: 'layout/cabecalho', props: { fixo: '{props.fixo}', centro: '{props.menuCentro}' }, slots: { filhos: [
      { bloco: 'nav/link', props: { href: '{props.href ?? "/"}' }, slots: { filhos: [
        { bloco: 'midia/imagem', se: 'props.logo', props: { src: '{props.logo}', alt: '', altura: 32 } },
        { bloco: 'texto/destaque', se: 'props.titulo && !props.tituloNivel', props: { texto: '{props.titulo}' } },
        { bloco: 'texto/titulo', se: 'props.titulo && props.tituloNivel', props: { texto: '{props.titulo}', nivel: '{props.tituloNivel}' } },
      ] } },
      { bloco: 'nav/alternador', id: 'cabecalho-alternador', se: 'props.menuRecolhivel != false', props: { rotulo: '{props.rotuloAlternador ?? "Abrir o menu"}' } },
      { bloco: 'texto/rotulo', se: 'props.menuRecolhivel != false', props: { texto: 'Menu', para: 'cabecalho-alternador' } },
      { bloco: 'nav/menu', se: 'tamanho(props.links ?? []) + tamanho(props.grupos ?? []) > 0', props: { rotulo: '{props.rotuloMenu ?? "Principal"}' }, slots: { filhos: [
        GRUPOS_DO_MENU('props.gruposAntes'),
        { bloco: 'nav/link', repetir: { cada: 'props.links ?? []', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}' } },
        GRUPOS_DO_MENU('!props.gruposAntes'),
      ] } },
      { bloco: 'core/slot', props: { nome: 'acoes' } },
    ] } },
  }),
]


// a grade de colunas do rodapé (cada uma com título e menu próprio); `marca` dá às colunas um gancho de estilo
const COLUNAS_RODAPE = { bloco: 'layout/grade', props: { colunas: '{tamanho(props.colunas ?? [])}', gap: 24 }, slots: { filhos: [
  { bloco: 'layout/pilha', repetir: { cada: 'props.colunas ?? []', como: 'c', chave: 'c.titulo' }, props: { gap: 8, marca: 'rodape-coluna' }, slots: { filhos: [
    { bloco: 'texto/destaque', props: { texto: '{c.titulo}' } },
    { bloco: 'nav/menu', se: 'tamanho(c.links ?? []) > 0', props: { rotulo: '{c.titulo}' }, slots: { filhos: [
      { bloco: 'nav/link', repetir: { cada: 'c.links ?? []', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}' } },
    ] } },
  ] } },
] } }
const BLOCOS_RODAPE = [
  no('bloco', 'site.rodape', {
    interface: 'site/rodape', titulo: 'Rodapé do site',
    descricao: 'Fim da página: colunas de links (cada uma com título e um menu próprio, com nome acessível), uma linha de contato/endereço, o aviso legal (`copyright`) e o slot `extra` para o que a página quiser (ex.: um formulário de assinatura). Usa `<footer>` e `<nav>` e só variáveis do tema.',
    props: { type: 'object', properties: {
      colunas: { type: 'array', maxItems: 6, items: colunaProp, description: 'grupos de links' }, contato: { type: 'string', maxLength: 300, description: 'telefone, e-mail ou endereço, numa linha' },
      copyright: { type: 'string', maxLength: 300, description: 'aviso legal, ex.: © 2026 Minha loja' },
      marca: { type: 'string', maxLength: 80, description: 'nome da marca, em destaque à esquerda das colunas' }, descricao: { type: 'string', maxLength: 300, description: 'frase curta sob a marca' },
    } },
    slots: { extra: {} },
    exemplos: [
      { titulo: 'Colunas e aviso', instancia: instancia('site/rodape', { colunas: [{ titulo: 'Loja', links: [{ texto: 'Produtos', href: '/produtos' }, { texto: 'Contato', href: '/contato' }] }, { titulo: 'Ajuda', links: [{ texto: 'Sobre', href: '/sobre' }] }], contato: 'contato@exemplo.com · (11) 4000-0000', copyright: '© 2026 Minha loja' }) },
      { titulo: 'Só o aviso, com extra', instancia: instancia('site/rodape', { copyright: '© 2026 Minha loja' }, { extra: [{ bloco: 'nav/link', props: { href: '/termos', texto: 'Termos de uso' } }] }) },
    ],
    modelo: { bloco: 'layout/rodape', slots: { filhos: [
      // com `marca`: a marca (e a frase) à esquerda e as colunas à direita; sem ela, só as colunas, como antes
      { bloco: 'layout/grade', se: 'props.marca', props: { colunas: 2, gap: 48 }, slots: { filhos: [
        { bloco: 'layout/pilha', props: { gap: 12, marca: 'rodape-marca' }, slots: { filhos: [
          { bloco: 'texto/destaque', props: { texto: '{props.marca}' } },
          { bloco: 'texto/pequeno', se: 'props.descricao', props: { texto: '{props.descricao}' } },
        ] } },
        COLUNAS_RODAPE,
      ] } },
      { ...COLUNAS_RODAPE, se: '!props.marca && tamanho(props.colunas ?? []) > 0' },
      { bloco: 'core/slot', props: { nome: 'extra' } },
      { bloco: 'texto/paragrafo', se: 'props.contato', props: { texto: '{props.contato}' } },
      { bloco: 'layout/divisor', se: 'props.copyright' },
      { bloco: 'texto/pequeno', se: 'props.copyright', props: { texto: '{props.copyright}' } },
    ] } },
  }),
]


const ctaProp = { type: 'object', properties: { texto: { type: 'string', maxLength: 60 }, href: { type: 'string', maxLength: 500 } }, required: ['texto', 'href'] }

const BLOCOS_HERO = [
  no('bloco', 'site.hero', {
    interface: 'site/hero', titulo: 'Hero (banner de destaque)',
    descricao: 'Faixa de abertura da página: `titulo` (o `<h1>`), `subtitulo`, até dois botões de ação (`cta` primário e `cta2` secundário) e o slot `extra`. O fundo é a cor primária do tema (ou `suave`), ou uma `imagem` do próprio site com véu escuro (`escurece`) para o texto ler. `alinha`: centro (padrão) ou esquerda. O título deve ser o único `<h1>` da página.',
    props: { type: 'object', properties: {
      titulo: { type: 'string', maxLength: 140 }, subtitulo: { type: 'string', maxLength: 300 }, cta: ctaProp, cta2: ctaProp,
      imagem: { type: 'string', maxLength: 500, description: 'URL segura da MESMA origem (o CSP das páginas só carrega imagens do próprio site)' }, altura: { type: 'number', minimum: 120, maximum: 800, default: 320 },
      escurece: { type: 'number', minimum: 0, maximum: 0.8, default: 0.45 }, alinha: { type: 'string', maxLength: 10, description: 'centro ou esquerda' }, fundo: { type: 'string', maxLength: 10, description: 'sem imagem: primaria ou suave' },
    }, required: ['titulo'] },
    slots: { extra: {} },
    exemplos: [
      { titulo: 'Título, subtítulo e dois botões', instancia: instancia('site/hero', { titulo: 'Tudo para a sua casa', subtitulo: 'Ofertas novas toda semana, com entrega rápida.', cta: { texto: 'Ver ofertas', href: '/produtos' }, cta2: { texto: 'Falar conosco', href: '/contato' } }) },
      { titulo: 'À esquerda, fundo suave', instancia: instancia('site/hero', { titulo: 'Frete grátis', subtitulo: 'Em compras acima de R$ 99.', alinha: 'esquerda', fundo: 'suave', altura: 200, cta: { texto: 'Aproveitar', href: '/produtos' } }) },
    ],
    modelo: { bloco: 'layout/destaque', props: { imagem: '{props.imagem}', altura: '{props.altura}', escurece: '{props.escurece}', alinha: '{props.alinha}', fundo: '{props.fundo}' }, slots: { filhos: [
      { bloco: 'texto/titulo', props: { texto: '{props.titulo}', nivel: 1 } },
      { bloco: 'texto/paragrafo', se: 'props.subtitulo', props: { texto: '{props.subtitulo}' } },
      { bloco: 'layout/linha', se: 'props.cta || props.cta2', props: { gap: 12 }, slots: { filhos: [
        { bloco: 'nav/link', se: 'props.cta', props: { href: '{props.cta.href}', texto: '{props.cta.texto}', botao: 'primario' } },
        { bloco: 'nav/link', se: 'props.cta2', props: { href: '{props.cta2.href}', texto: '{props.cta2.texto}', botao: 'secundario' } },
      ] } },
      { bloco: 'core/slot', props: { nome: 'extra' } },
    ] } },
  }),
]

const BLOCOS_BUSCA = [
  no('bloco', 'site.busca', {
    interface: 'site/busca', titulo: 'Barra de busca',
    descricao: 'Campo de busca com botão: um formulário `GET` que leva o termo (`?q=…`) a uma página do próprio site (`acao`, padrão `/busca`), que o lê em `consulta.q`. Funciona sem JavaScript. `valor` preenche o campo (use `{consulta.q}` na página de resultados) e `rotulo` dá o nome acessível. Cabe no slot `acoes` do `site/cabecalho`.',
    props: { type: 'object', properties: {
      acao: { type: 'string', maxLength: 300, description: 'caminho do PRÓPRIO site (padrão /busca)' }, nome: { type: 'string', maxLength: 31, description: 'parâmetro na URL (padrão q)' },
      valor: { type: 'string', maxLength: 200 }, placeholder: { type: 'string', maxLength: 100, default: 'Buscar' }, rotulo: { type: 'string', maxLength: 100, default: 'Buscar' }, botao: { type: 'string', maxLength: 60, default: 'Buscar' },
      sugestoesUrl: { type: 'string', maxLength: 300, description: 'sugestões AO VIVO: caminho do próprio site que devolve JSON (ex.: /api/loja/destaques); o cliente busca `busca=<termo>` a cada pausa na digitação. Precisa de JavaScript' }, sugestoesTitulo: { type: 'string', maxLength: 41, default: 'titulo' }, sugestoesDescricao: { type: 'string', maxLength: 41 }, sugestoesImagem: { type: 'string', maxLength: 41, description: 'campo com o caminho da miniatura' }, sugestoesLimite: { type: 'integer', minimum: 1, maximum: 10, default: 6 }, sugestoesDestino: { type: 'string', maxLength: 300, description: 'página aberta ao escolher (padrão: a própria `acao`)' },
      sugestoes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 }, description: 'termos que o navegador oferece enquanto se digita (lista nativa, sem JavaScript; fixos na página). Uma barra com sugestões por página (o id da lista é fixo)' },
    } },
    exemplos: [
      { titulo: 'Padrão', instancia: instancia('site/busca', {}) },
      { titulo: 'Com sugestões ao vivo', instancia: instancia('site/busca', { sugestoesUrl: '/api/loja/destaques', sugestoesImagem: 'imagem' }) },
      { titulo: 'Com sugestões', instancia: instancia('site/busca', { sugestoes: ['Café', 'Cafeteira italiana', 'Chá verde'] }) },
      { titulo: 'Com termo e outro destino', instancia: instancia('site/busca', { acao: '/produtos', valor: 'café', placeholder: 'Buscar produtos', botao: 'Procurar' }) },
    ],
    modelo: { bloco: 'form/busca', props: { acao: '{props.acao}' }, slots: { filhos: [
      { bloco: 'entrada/busca', props: { nome: '{props.nome}', valor: '{props.valor}', placeholder: '{props.placeholder ?? "Buscar"}', rotulo: '{props.rotulo ?? "Buscar"}', lista: '{tamanho(props.sugestoes ?? []) > 0 ? "busca-sugestoes" : ""}' } },
      { bloco: 'form/sugestoes', id: 'busca-sugestoes', se: 'tamanho(props.sugestoes ?? []) > 0', slots: { filhos: [
        { bloco: 'form/opcao', repetir: { cada: 'props.sugestoes ?? []', como: 's', chave: 's' }, props: { valor: '{s}' } },
      ] } },
      { bloco: 'form/sugestoes-ao-vivo', se: 'props.sugestoesUrl', props: { url: '{props.sugestoesUrl}', titulo: '{props.sugestoesTitulo ?? "titulo"}', descricao: '{props.sugestoesDescricao ?? ""}', imagem: '{props.sugestoesImagem ?? ""}', limite: '{props.sugestoesLimite ?? 6}', destino: '{props.sugestoesDestino ?? props.acao ?? "/busca"}', nome: '{props.nome}' } },
      { bloco: 'nav/enviar', props: { texto: '{props.botao ?? "Buscar"}' } },
    ] } },
  }),
]

const BLOCOS_LATERAL = [
  no('bloco', 'site.menu-lateral', {
    interface: 'site/menu-lateral', titulo: 'Menu lateral',
    descricao: 'Coluna lateral de navegação para aplicações e painéis (use dentro de um `layout/painel`, ao lado do `layout/principal`): grupos de links com título (`grupos`, `atual` marca a página aberta) e os slots `topo` (antes do menu, ex.: marca ou busca) e `filhos` (depois: qualquer conteúdo, como botões de ação num `nav/menu`). No celular a lateral fica atrás de um botão ("Seções", `rotuloAlternador`), sem JavaScript. Usa `<aside>` e `<nav>` com nome acessível e só variáveis do tema. Uma por página (o `id` do alternador é fixo).',
    props: { type: 'object', properties: {
      rotulo: { type: 'string', maxLength: 80, default: 'Navegação lateral', description: 'nome acessível da lateral' }, rotuloMenu: { type: 'string', maxLength: 80, default: 'Seções', description: 'nome acessível do menu de links' },
      rotuloAlternador: { type: 'string', maxLength: 60, default: 'Abrir as seções' }, textoAlternador: { type: 'string', maxLength: 40, default: 'Seções', description: 'o texto do botão no celular' },
      grupos: { type: 'array', maxItems: 12, items: colunaProp, description: 'grupos de links: `titulo` e `links` (`texto`, `href`, `atual`)' },
    } },
    slots: { topo: {}, filhos: {} },
    exemplos: [
      { titulo: 'Grupos de links', instancia: instancia('site/menu-lateral', { grupos: [{ titulo: 'Conta', links: [{ texto: 'Perfil', href: '/perfil', atual: true }, { texto: 'Segurança', href: '/seguranca' }] }, { titulo: 'Loja', links: [{ texto: 'Pedidos', href: '/pedidos' }] }] }) },
    ],
    modelo: { bloco: 'layout/lateral', props: { rotulo: '{props.rotulo ?? "Navegação lateral"}' }, slots: { filhos: [
      { bloco: 'nav/alternador', id: 'lateral-alternador', props: { rotulo: '{props.rotuloAlternador ?? "Abrir as seções"}' } },
      { bloco: 'texto/rotulo', props: { texto: '{props.textoAlternador ?? "Seções"}', para: 'lateral-alternador' } },
      { bloco: 'core/slot', props: { nome: 'topo' } },
      { bloco: 'nav/menu', se: 'tamanho(props.grupos ?? []) > 0', props: { rotulo: '{props.rotuloMenu ?? "Seções"}' }, slots: { filhos: [
        { bloco: 'layout/pilha', repetir: { cada: 'props.grupos ?? []', como: 'g', chave: 'g.titulo' }, props: { gap: 0 }, slots: { filhos: [
          { bloco: 'texto/pequeno', props: { texto: '{g.titulo}' } },
          { bloco: 'nav/link', repetir: { cada: 'g.links ?? []', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}' } },
        ] } },
      ] } },
      { bloco: 'core/slot', props: { nome: 'filhos' } },
    ] } },
  }),
]

// Abas de navegação: a fileira de links de categoria de uma loja (um é o atual). Rola na horizontal em tela estreita, sem barra visível.
const BLOCOS_ABAS = [
  no('bloco', 'site.abas', {
    interface: 'site/abas', titulo: 'Abas de navegação',
    descricao: 'Fileira de abas (links) para trocar de categoria ou de visão: `itens` com `texto`, `href` e `atual` (a aba escolhida, `aria-current`). É um `nav` com nome acessível (`rotulo`); rola na horizontal quando não cabe. O visual (caixa alta, aba ativa preenchida) vem dos tokens `abas.*` do tema.',
    props: { type: 'object', properties: { rotulo: { type: 'string', maxLength: 80, description: 'nome acessível do menu (padrão "Principal")' }, itens: { type: 'array', maxItems: 24, items: { ...linkProp, properties: { ...linkProp.properties, soConsulta: { type: 'boolean', description: 'trocar de aba só muda a consulta da URL (sem recarregar a página)' } } }, description: 'as abas, na ordem' } }, required: ['itens'] },
    exemplos: [{ titulo: 'Categorias', instancia: instancia('site/abas', { rotulo: 'Categorias', itens: [{ texto: 'Todas', href: '/produtos', atual: true }, { texto: 'Iluminação', href: '/produtos?c=luz' }, { texto: 'Cerâmica', href: '/produtos?c=ceramica' }] }) }],
    modelo: { bloco: 'nav/menu', props: { rotulo: '{props.rotulo}', marca: 'abas' }, slots: { filhos: [
      { bloco: 'nav/link', repetir: { cada: 'props.itens ?? []', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}', soConsulta: '{l.soConsulta == true}' } },
    ] } },
  }),
]
export const BLOCOS_SITE = [...BLOCOS_CABECALHO, ...BLOCOS_ABAS, ...BLOCOS_RODAPE, ...BLOCOS_HERO, ...BLOCOS_BUSCA, ...BLOCOS_LATERAL]
export function registraSite(reg: Registry): void { for (const n of BLOCOS_SITE) reg.registra(n as never) }
export { NOMES_ICONES } from '../icones/nomes'
