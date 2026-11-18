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

export const BLOCOS_SITE = [...BLOCOS_CABECALHO, ...BLOCOS_RODAPE]
export function registraSite(reg: Registry): void { for (const n of BLOCOS_SITE) reg.registra(n as never) }
