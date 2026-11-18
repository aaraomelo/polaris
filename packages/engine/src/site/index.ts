import type { Registry } from '@polaris/schema'

// Blocos do SITE, 100% declarativos (kind `bloco` com `modelo` sobre os blocos base): nenhum código novo no runtime, então herdam hidratação, streaming, tema e tree-shaking.
// O modelo não tem estado nem eventos (é função das props): o que depende da página (botão "Entrar", carrinho…) entra pelo slot `acoes`.

type Inst = { bloco: string; id?: string; props?: Record<string, unknown>; slots?: Record<string, Inst[]>; se?: string; repetir?: { cada: string; como: string; chave?: string } }
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec })
const instancia = (bloco: string, props: Record<string, unknown>, slots?: Record<string, Inst[]>): Inst => ({ bloco, props, ...(slots ? { slots } : {}) })

const linkProp = { type: 'object', properties: { texto: { type: 'string', maxLength: 80 }, href: { type: 'string', maxLength: 500 }, atual: { type: 'boolean', description: 'a página aberta (aria-current)' } }, required: ['texto', 'href'] }

const BLOCOS_CABECALHO = [
  no('bloco', 'site.cabecalho', {
    interface: 'site/cabecalho', titulo: 'Cabeçalho do site',
    descricao: 'Topo da página: marca (logo e/ou nome, ligada ao início), menu de navegação (`links`, com `atual` na página aberta) e o slot `acoes` à direita (ex.: botão de entrar ou carrinho). `fixo` o mantém no topo ao rolar. Usa `<header>` e `<nav>` (pontos de referência para leitores de tela) e só variáveis do tema.',
    props: { type: 'object', properties: {
      titulo: { type: 'string', maxLength: 80, description: 'nome da marca' }, logo: { type: 'string', maxLength: 500, description: 'URL segura da imagem da marca' },
      href: { type: 'string', maxLength: 500, default: '/', description: 'para onde a marca leva' }, links: { type: 'array', maxItems: 12, items: linkProp, description: 'o menu' },
      rotuloMenu: { type: 'string', maxLength: 80, default: 'Principal' }, fixo: { type: 'boolean', default: false },
    } },
    slots: { acoes: {} },
    exemplos: [
      { titulo: 'Marca e menu', instancia: instancia('site/cabecalho', { titulo: 'Loja Demo', links: [{ texto: 'Início', href: '/', atual: true }, { texto: 'Produtos', href: '/produtos' }, { texto: 'Contato', href: '/contato' }] }) },
      { titulo: 'Com ação e fixo', instancia: instancia('site/cabecalho', { titulo: 'Loja Demo', fixo: true, links: [{ texto: 'Início', href: '/' }] }, { acoes: [{ bloco: 'nav/link', props: { href: '/entrar', texto: 'Entrar' } }] }) },
    ],
    modelo: { bloco: 'layout/cabecalho', props: { fixo: '{props.fixo}' }, slots: { filhos: [
      { bloco: 'nav/link', props: { href: '{props.href ?? "/"}' }, slots: { filhos: [
        { bloco: 'midia/imagem', se: 'props.logo', props: { src: '{props.logo}', alt: '', altura: 32 } },
        { bloco: 'texto/destaque', se: 'props.titulo', props: { texto: '{props.titulo}' } },
      ] } },
      { bloco: 'nav/menu', se: 'tamanho(props.links ?? []) > 0', props: { rotulo: '{props.rotuloMenu ?? "Principal"}' }, slots: { filhos: [
        { bloco: 'nav/link', repetir: { cada: 'props.links ?? []', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}' } },
      ] } },
      { bloco: 'core/slot', props: { nome: 'acoes' } },
    ] } },
  }),
]

const colunaProp = { type: 'object', properties: { titulo: { type: 'string', maxLength: 80 }, links: { type: 'array', maxItems: 12, items: linkProp } }, required: ['titulo'] }

const BLOCOS_RODAPE = [
  no('bloco', 'site.rodape', {
    interface: 'site/rodape', titulo: 'Rodapé do site',
    descricao: 'Fim da página: colunas de links (cada uma com título e um menu próprio, com nome acessível), uma linha de contato/endereço, o aviso legal (`copyright`) e o slot `extra` para o que a página quiser (ex.: um formulário de assinatura). Usa `<footer>` e `<nav>` e só variáveis do tema.',
    props: { type: 'object', properties: {
      colunas: { type: 'array', maxItems: 6, items: colunaProp, description: 'grupos de links' }, contato: { type: 'string', maxLength: 300, description: 'telefone, e-mail ou endereço, numa linha' },
      copyright: { type: 'string', maxLength: 300, description: 'aviso legal, ex.: © 2026 Minha loja' },
    } },
    slots: { extra: {} },
    exemplos: [
      { titulo: 'Colunas e aviso', instancia: instancia('site/rodape', { colunas: [{ titulo: 'Loja', links: [{ texto: 'Produtos', href: '/produtos' }, { texto: 'Contato', href: '/contato' }] }, { titulo: 'Ajuda', links: [{ texto: 'Sobre', href: '/sobre' }] }], contato: 'contato@exemplo.com · (11) 4000-0000', copyright: '© 2026 Minha loja' }) },
      { titulo: 'Só o aviso, com extra', instancia: instancia('site/rodape', { copyright: '© 2026 Minha loja' }, { extra: [{ bloco: 'nav/link', props: { href: '/termos', texto: 'Termos de uso' } }] }) },
    ],
    modelo: { bloco: 'layout/rodape', slots: { filhos: [
      { bloco: 'layout/grade', se: 'tamanho(props.colunas ?? []) > 0', props: { colunas: '{tamanho(props.colunas ?? [])}', gap: 24 }, slots: { filhos: [
        { bloco: 'layout/pilha', repetir: { cada: 'props.colunas ?? []', como: 'c', chave: 'c.titulo' }, props: { gap: 8 }, slots: { filhos: [
          { bloco: 'texto/destaque', props: { texto: '{c.titulo}' } },
          { bloco: 'nav/menu', se: 'tamanho(c.links ?? []) > 0', props: { rotulo: '{c.titulo}' }, slots: { filhos: [
            { bloco: 'nav/link', repetir: { cada: 'c.links ?? []', como: 'l', chave: 'l.href' }, props: { href: '{l.href}', texto: '{l.texto}', atual: '{l.atual == true}' } },
          ] } },
        ] } },
      ] } },
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

export const BLOCOS_SITE = [...BLOCOS_CABECALHO, ...BLOCOS_RODAPE, ...BLOCOS_HERO]
export function registraSite(reg: Registry): void { for (const n of BLOCOS_SITE) reg.registra(n as never) }
