import { P, botao, def, exe, linha, no, pilha, q, texto, titulo, type Acao, type Inst } from './dsl'

// O Studio como PÁGINA da plataforma: estado, dados (a API de autoria declarada como `servico` studio), ações e blocos. Sem código escrito à mão: tudo aqui vira JSON validado pelo schema.
// Este arquivo só ENCURTA a escrita; a saída (packages/packs/nos/studio/pagina-studio.json) é o que vale, e um teste garante que ela é exatamente a gerada daqui.

const campo = (tipo: string, extra: object = {}) => ({ tipo, ...extra })
const dado = (id: string, operacao: string, parametros: Record<string, object> = {}, carregar: 'auto' | 'manual' = 'manual') =>
  no('dados', `studio.${id}`, { fonte: { tipo: 'servico', servico: 'studio', operacao }, ...(Object.keys(parametros).length ? { parametros } : {}), carregar, timeoutMs: 15000 })

export const DADOS = [
  dado('nos', 'listarNos', {}, 'auto'),
  dado('blocos', 'listarBlocos', {}, 'auto'),
  dado('abrir', 'abrirNo', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }) }),
  dado('salvar', 'salvarNo', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }), no: campo('json', { obrigatorio: true }), baseSeq: campo('json'), nota: campo('texto') }),
  dado('previa', 'previsualizar', { no: campo('json', { obrigatorio: true }), tema: campo('json'), selecionado: campo('texto') }),
]

/** a página que o editor de tema usa como amostra */
const AMOSTRA = { kind: 'pagina', id: 'amostra', versao: '1.0.0', spec: { rota: '/amostra', raiz: { bloco: 'layout/pilha', props: { gap: 12 }, slots: { filhos: [
  { bloco: 'texto/titulo', props: { texto: 'Título de exemplo', nivel: 1 } }, { bloco: 'texto/paragrafo', props: { texto: 'Um parágrafo com o texto principal do tema.' } },
  { bloco: 'texto/pequeno', props: { texto: 'Texto suave, menor.' } }, { bloco: 'nav/botao', props: { texto: 'Botão' } },
  { bloco: 'feedback/selo', props: { texto: 'Sucesso', tom: 'sucesso' } }, { bloco: 'feedback/selo', props: { texto: 'Alerta', tom: 'alerta' } }, { bloco: 'feedback/selo', props: { texto: 'Erro', tom: 'erro' } },
] } } } }

const aviso = (tipo: 'sucesso' | 'erro' | 'neutro', msg: string): Acao[] => [def('tipoAviso', q(tipo)), def('aviso', msg)]
const atualizaPrevia: Acao = exe('previa', { no: AMOSTRA, tema: '{estado.no}' })

/** abrir um nó: carrega, guarda o rascunho e a cópia salva (para saber se há alteração) e gera a prévia */
const abrir = (kind: string, id: string): Acao => exe('abrir', { kind: q(kind).slice(1, -1), id: `{${id}}` }, [
  def('aberto', `objeto([["kind", ${q(kind)}], ["id", ${id}], ["origem", resultado.origem], ["seq", resultado.seq]])`), def('no', 'resultado.no'), def('noSalvo', 'resultado.no'), def('aviso', '""'), atualizaPrevia,
], aviso('erro', 'erro'))

const seletorDeNos = (kind: 'tema' | 'pagina'): Inst => pilha([
  titulo(kind === 'tema' ? 'Temas' : 'Páginas', 3),
  linha([
    P('layout/linha', { repetir: { cada: `filtra(nos.nos, n => n.kind == ${q(kind)})`, como: 'n', chave: 'n.id' }, props: { gap: 4 }, filhos: [botao('{n.id} ●', [abrir(kind, 'n.id')])] }),
    P('layout/linha', { repetir: { cada: `nos.base.${kind}`, como: 'b', chave: 'b' }, props: { gap: 4 }, filhos: [botao('{b} (padrão)', [abrir(kind, 'b')])] }),
  ], { props: { gap: 8 } }),
], { gap: 4 })

const linhaToken = (): Inst => linha([
  P('texto/rotulo', { props: { texto: '{t[0]}' } }),
  P('entrada/texto', {
    props: { valor: '{t[1]}', rotulo: '{g} {t[0]}' },
    eventos: { aoMudar: [def('no', 'com(estado.no, ["spec", "tokens", g, t[0]], g == "cor" ? evento : (numero(evento) ?? evento))'), atualizaPrevia] },
  }),
], { repetir: { cada: 'entradas(estado.no.spec.tokens[g])', como: 't', chave: 't[0]' }, props: { gap: 8 } })

const editorDeTema = (): Inst => pilha([
  titulo('Tokens do tema {estado.aberto.id}', 3),
  P('layout/grade', { props: { colunas: 2, gap: 16 }, filhos: [
    pilha([
      pilha([titulo('{g}', 4), linhaToken()], { repetir: { cada: 'filtra(["cor", "espacamento", "raio"], g => estado.no.spec.tokens[g])', como: 'g', chave: 'g' }, gap: 4 }),
    ], { gap: 12 }),
    pilha([titulo('Amostra', 4), P('midia/quadro', { props: { titulo: 'Amostra do tema', html: '{previa.html}', altura: 420 } })], { gap: 4 }),
  ] }),
], { se: 'estado.no && estado.aberto.kind == "tema"', gap: 8 })

export const PAGINA = no('pagina', 'studio.app', {
  rota: '/studio', titulo: 'Polaris Studio',
  guarda: [],
  dados: { nos: 'studio.nos', blocos: 'studio.blocos', abrir: 'studio.abrir', salvar: 'studio.salvar', previa: 'studio.previa' },
  estado: { aberto: { tipo: 'json' }, no: { tipo: 'json' }, noSalvo: { tipo: 'json' }, aviso: { tipo: 'texto', inicial: '' }, tipoAviso: { tipo: 'texto', inicial: 'neutro' } },
  raiz: pilha([
    linha([
      titulo('Polaris Studio', 1),
      botao('Salvar', [exe('salvar', { kind: '{estado.aberto.kind}', id: '{estado.aberto.id}', no: '{estado.no}', baseSeq: '{estado.aberto.seq}' }, [
        def('aberto', 'com(com(estado.aberto, ["seq"], resultado.versao.seq), ["origem"], "tenant")'), def('noSalvo', 'estado.no'), ...aviso('sucesso', '"Salvo como versão " + resultado.versao.seq'), exe('nos'),
      ], aviso('erro', 'erro'))], { se: 'estado.no', props: { desabilitado: false } }),
      texto('{estado.no ? (igual(estado.no, estado.noSalvo) ? (estado.aberto.origem == "base" ? "padrão da plataforma" : "salvo (v" + estado.aberto.seq + ")") : "● alterações não salvas") : ""}'),
    ]),
    ...(['sucesso', 'erro', 'neutro'] as const).map((tom) => P('feedback/alerta', { se: `estado.aviso && estado.tipoAviso == ${q(tom)}`, props: { tom }, filhos: [texto('{estado.aviso}')] })),
    seletorDeNos('tema'),
    editorDeTema(),
  ], { gap: 12 }),
})

export const NOS_DO_STUDIO = [...DADOS, PAGINA]
