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
  dado('versoes', 'listarVersoes', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }) }),
  dado('versao', 'abrirVersao', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }), seq: campo('inteiro', { obrigatorio: true }) }),
  dado('diff', 'compararVersoes', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }), de: campo('texto', { obrigatorio: true }), para: campo('texto', { obrigatorio: true }) }),
  dado('comentarios', 'listarComentarios', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }) }),
  dado('comentar', 'comentar', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }), texto: campo('texto', { obrigatorio: true }), ancora: campo('texto'), versao: campo('inteiro'), respondeA: campo('texto') }),
  dado('resolver', 'resolverComentario', { cid: campo('texto', { obrigatorio: true }), resolvido: campo('booleano', { obrigatorio: true }) }),
  dado('site', 'obterSite', {}, 'auto'),
  dado('definetema', 'definirTemaDoSite', { tema: campo('texto', { obrigatorio: true }) }),
  dado('publicar', 'publicarSite', { nota: campo('texto') }),
  dado('previa', 'previsualizar', { no: campo('json', { obrigatorio: true }), tema: campo('json'), selecionado: campo('texto') }),
]

/** a página que o editor de tema usa como amostra */
const AMOSTRA = { kind: 'pagina', id: 'amostra', versao: '1.0.0', spec: { rota: '/amostra', raiz: { bloco: 'layout/pilha', props: { gap: 12 }, slots: { filhos: [
  { bloco: 'texto/titulo', props: { texto: 'Título de exemplo', nivel: 1 } }, { bloco: 'texto/paragrafo', props: { texto: 'Um parágrafo com o texto principal do tema.' } },
  { bloco: 'texto/pequeno', props: { texto: 'Texto suave, menor.' } }, { bloco: 'nav/botao', props: { texto: 'Botão' } },
  { bloco: 'feedback/selo', props: { texto: 'Sucesso', tom: 'sucesso' } }, { bloco: 'feedback/selo', props: { texto: 'Alerta', tom: 'alerta' } }, { bloco: 'feedback/selo', props: { texto: 'Erro', tom: 'erro' } },
] } } } }

// ---- pedaços de expressão que se repetem --------------------------------------------------------------------------------------------------------
const EH_PAGINA = 'estado.aberto.kind == "pagina"', EH_TEMA = 'estado.aberto.kind == "tema"'
const RAIZ = 'estado.no.spec.raiz', SELNO = `obter(${RAIZ}, estado.sel)`, DOCSEL = 'concat(["spec", "raiz"], estado.sel)'
const DEFBLOCO = `acha(blocos.blocos, b => b.id == ${SELNO}.bloco)`

const aviso = (tipo: 'sucesso' | 'erro' | 'neutro', msg: string): Acao[] => [def('tipoAviso', q(tipo)), def('aviso', msg)]
/** a prévia: de uma página, o RASCUNHO (com o bloco selecionado destacado); de um tema, a página de amostra com o tema aplicado */
const atualizaPrevia: Acao = exe('previa', {
  no: `{${EH_PAGINA} ? estado.no : estado.amostra}`, tema: `{${EH_TEMA} ? estado.no : null}`, selecionado: `{${EH_PAGINA} ? (${SELNO}.id ?? "") : ""}`,
})
/** toda edição do rascunho passa por aqui: guarda o anterior para desfazer (edições seguidas do MESMO campo, `chave`, viram um passo só), limpa o refazer e atualiza a prévia */
const edita = (novo: string, chave = '""'): Acao[] => [
  def('passado', `${chave} != "" && estado.chaveEdicao == ${chave} ? estado.passado : fatia(concat(estado.passado, [estado.no]), -60)`), def('futuro', '[]'), def('chaveEdicao', chave), def('no', novo), atualizaPrevia,
]
const desfaz: Acao[] = [def('futuro', 'concat(estado.futuro, [estado.no])'), def('no', 'ultimo(estado.passado)'), def('passado', 'fatia(estado.passado, 0, -1)'), def('chaveEdicao', '""'), atualizaPrevia]
const refaz: Acao[] = [def('passado', 'concat(estado.passado, [estado.no])'), def('no', 'ultimo(estado.futuro)'), def('futuro', 'fatia(estado.futuro, 0, -1)'), def('chaveEdicao', '""'), atualizaPrevia]

/** histórico e comentários do nó aberto (só existem para nó já salvo no servidor) */
const carregaLateral = (kind: string, id: string): Acao[] => [exe('versoes', { kind, id: `{${id}}` }), exe('comentarios', { kind, id: `{${id}}` })]
/** abrir um nó: carrega, guarda o rascunho e a cópia salva (para saber se há alteração) e gera a prévia */
const abrir = (kind: string, id: string): Acao => exe('abrir', { kind, id: `{${id}}` }, [
  def('aberto', `objeto([["kind", ${q(kind)}], ["id", ${id}], ["origem", resultado.origem], ["seq", resultado.seq]])`), def('no', 'resultado.no'), def('noSalvo', 'resultado.no'),
  def('passado', '[]'), def('futuro', '[]'), def('chaveEdicao', '""'), def('sel', '[]'), def('aviso', '""'), def('aba', '"editor"'), def('de', '""'), def('para', '""'), atualizaPrevia, ...carregaLateral(kind, id),
], aviso('erro', 'erro'))

const seletorDeNos = (kind: 'tema' | 'pagina'): Inst => pilha([
  titulo(kind === 'tema' ? 'Temas' : 'Páginas', 3),
  linha([
    P('layout/linha', { repetir: { cada: `filtra(nos.nos, n => n.kind == ${q(kind)})`, como: 'n', chave: 'n.id' }, props: { gap: 4 }, filhos: [botao('{n.id} (personalizado)', [abrir(kind, 'n.id')])] }),
    P('layout/linha', { repetir: { cada: `filtra(nos.base.${kind}, b => !comeca(b, "studio.") && tamanho(filtra(nos.nos, n => n.kind == ${q(kind)} && n.id == b)) == 0)`, como: 'b', chave: 'b' }, props: { gap: 4 }, filhos: [botao('{b} (padrão)', [abrir(kind, 'b')])] }),
  ], { props: { gap: 8 } }),
], { gap: 4 })

// ---- editor de tema ----------------------------------------------------------------------------------------------------------------------------
const linhaToken = (): Inst => linha([
  P('texto/rotulo', { props: { texto: '{t[0]}' } }),
  P('entrada/texto', { props: { valor: '{t[1]}', rotulo: '{g} {t[0]}' }, eventos: { aoMudar: edita('com(estado.no, ["spec", "tokens", g, t[0]], g == "cor" ? evento : (paraNumero(evento) ?? evento))', '"tk:" + g + t[0]') } }),
  removeToken(),
], { repetir: { cada: 'entradas(estado.no.spec.tokens[g])', como: 't', chave: 't[0]' }, props: { gap: 8 } })

const removeToken = (): Inst => botao('✕', edita('sem(estado.no, ["spec", "tokens", g, t[0]])'), { props: {} })
const novoToken = (): Inst => linha([
  P('entrada/texto', { props: { valor: '{estado.novoTokenNome}', rotulo: 'novo token de {g}', placeholder: 'nome' }, eventos: { aoMudar: [def('novoTokenNome', 'evento')] } }),
  P('entrada/texto', { props: { valor: '{estado.novoTokenValor}', rotulo: 'valor do novo token de {g}', placeholder: 'valor' }, eventos: { aoMudar: [def('novoTokenValor', 'evento')] } }),
  botao('Adicionar token', [...edita('com(estado.no, ["spec", "tokens", g, estado.novoTokenNome], paraNumero(estado.novoTokenValor) ?? estado.novoTokenValor)'), def('novoTokenNome', '""'), def('novoTokenValor', '""')], { se: 'estado.novoTokenNome != "" && estado.novoTokenValor != ""' }),
], { props: { gap: 4 } })

const editorDeTema = (): Inst => pilha([
  titulo('Tokens do tema {estado.aberto.id}', 3),
  linha([
    texto('Tema do site: {site.tema ?? "padrao (o padrão da plataforma)"}'),
    botao('Usar este tema no site', [exe('definetema', { tema: '{estado.aberto.id}' }, [...aviso('sucesso', '"Tema do site: " + resultado.tema + ". Publique para o site mudar."'), exe('site')], aviso('erro', 'erro'))],
      { se: 'igual(estado.no, estado.noSalvo) && estado.aberto.origem != "novo" && site.tema != estado.aberto.id' }),
  ], { props: { gap: 12 } }),
  P('layout/grade', { props: { colunas: 2, gap: 16 }, filhos: [
    pilha([pilha([titulo('{g}', 4), linhaToken(), novoToken()], { repetir: { cada: 'filtra(["cor", "espacamento", "raio"], g => estado.no.spec.tokens[g])', como: 'g', chave: 'g' }, gap: 4 })], { gap: 12 }),
    pilha([titulo('Amostra', 4), P('midia/quadro', { props: { titulo: 'Amostra do tema', html: '{previa.html}', altura: 420 } }),
      pilha([texto('Contraste baixo em {a.par} ({a.modo}): {a.contraste}:1; o mínimo é {a.minimo}:1', { repetir: { cada: 'previa.avisos ?? []', como: 'a', chave: 'a.modo + a.par' } })], { gap: 2 })], { gap: 4 }),
  ] }),
], { se: `estado.no && ${EH_TEMA} && estado.aba == "editor"`, gap: 8 })

// ---- editor de páginas ---------------------------------------------------------------------------------------------------------------------------
/** onde o bloco novo entra: no slot `filhos` do selecionado, ou no primeiro slot que ele declara */
const SLOT = `((${DEFBLOCO}).slots.filhos ? "filhos" : primeiro(chaves((${DEFBLOCO}).slots)))`
const CAMINHO_SLOT = `concat(${DOCSEL}, ["slots", ${SLOT}])`
/** props mínimas para o bloco novo ser válido: os campos obrigatórios de nível 1 com um valor razoável */
const PROPS_NOVAS = 'objeto(mapeia(filtra(camposDoSchema(bd.props), c => c.obrigatorio && tamanho(c.caminho) == 1), c => [c.nome, c.padrao ?? (c.tipo == "texto" ? c.rotulo : (c.tipo == "inteiro" || c.tipo == "numero") ? (c.min ?? 0) : c.tipo == "booleano" ? false : c.tipo == "escolha" ? c.opcoes[0] : null)]))'

const arvore = (): Inst => pilha([
  titulo('Blocos', 4),
  pilha([botao('{(x.nivel > 0 ? junta(mapeia(intervalo(0, x.nivel), i => "· "), "") : "") + (igual(x.caminho, estado.sel) ? "▶ " : "") + x.no.bloco + (x.no.id ? " #" + x.no.id : "")}', [def('sel', 'x.caminho'), atualizaPrevia], { props: {} })], { repetir: { cada: `percorre(${RAIZ}, "slots")`, como: 'x', chave: 'junta(mapeia(x.caminho, p => texto(p)), "/")' }, gap: 0 }),
])

const campoDeProp = (): Inst => pilha([
  P('texto/rotulo', { props: { texto: '{c.rotulo}{c.obrigatorio ? " *" : ""}' } }),
  P('entrada/texto', { se: 'c.tipo == "texto" || c.tipo == "inteiro" || c.tipo == "numero"', props: { valor: `{obter(${SELNO}.props, c.caminho)}`, rotulo: '{c.rotulo}' },
    eventos: { aoMudar: edita(`evento == "" ? sem(estado.no, concat(${DOCSEL}, ["props"], c.caminho)) : com(estado.no, concat(${DOCSEL}, ["props"], c.caminho), (c.tipo == "inteiro" || c.tipo == "numero") ? (paraNumero(evento) ?? evento) : evento)`, `"pr:" + junta(estado.sel, ".") + "." + junta(c.caminho, ".")`) } }),
  P('entrada/caixa', { se: 'c.tipo == "booleano"', props: { marcado: `{obter(${SELNO}.props, c.caminho) == true}`, rotulo: '{c.rotulo}' }, eventos: { aoMudar: edita(`com(estado.no, concat(${DOCSEL}, ["props"], c.caminho), evento)`) } }),
  linha([P('layout/linha', { repetir: { cada: 'c.opcoes', como: 'o', chave: 'texto(o)' }, filhos: [botao('{o}{obter(' + SELNO + '.props, c.caminho) == o ? " ✓" : ""}', edita(`com(estado.no, concat(${DOCSEL}, ["props"], c.caminho), o)`))] })], { se: 'c.tipo == "escolha"', props: { gap: 4 } }),
  texto('(valor estruturado: edite no JSON do nó)', { se: 'c.tipo == "json"' }),
], { repetir: { cada: `camposDoSchema((${DEFBLOCO}).props)`, como: 'c', chave: 'junta(c.caminho, ".")' }, gap: 2 })

const propriedades = (): Inst => pilha([
  titulo('{(' + SELNO + ').bloco}', 4),
  P('entrada/texto', { props: { valor: `{(${SELNO}).id ?? ""}`, rotulo: 'Identificador' }, eventos: { aoMudar: edita(`evento == "" ? sem(estado.no, concat(${DOCSEL}, ["id"])) : com(estado.no, concat(${DOCSEL}, ["id"]), evento)`, '"id:" + junta(estado.sel, ".")') } }),
  P('entrada/texto', { props: { valor: `{(${SELNO}).se ?? ""}`, rotulo: 'Exibir se (expressão)' }, eventos: { aoMudar: edita(`evento == "" ? sem(estado.no, concat(${DOCSEL}, ["se"])) : com(estado.no, concat(${DOCSEL}, ["se"]), evento)`, '"se:" + junta(estado.sel, ".")') } }),
  campoDeProp(),
  titulo('Adicionar dentro', 5),
  P('layout/linha', { props: { gap: 4 }, repetir: { cada: `filtra(blocos.blocos, bd => !${DEFBLOCO}.slots || (${DEFBLOCO}).slots.filhos || tamanho(chaves((${DEFBLOCO}).slots)) > 0)`, como: 'bd', chave: 'bd.id' }, filhos: [
    botao('+ {bd.id}', [
      def('chaveEdicao', '""'), def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'),
      def('no', `com(estado.no, ${CAMINHO_SLOT}, concat(obter(estado.no, ${CAMINHO_SLOT}) ?? [], [mescla(objeto([["bloco", bd.id], ["id", "b" + estado.contador]]), tamanho(chaves(${PROPS_NOVAS})) > 0 ? objeto([["props", ${PROPS_NOVAS}]]) : objeto([]))]))`),
      def('contador', 'estado.contador + 1'), atualizaPrevia,
    ]),
  ] }),
], { se: `estado.no && ${EH_PAGINA} && ${SELNO}`, gap: 6 })

const barraDeBloco = (): Inst => linha([
  botao('Remover', [
    def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'), def('chaveEdicao', '""'),
    def('no', `sem(estado.no, ${DOCSEL})`), def('sel', 'fatia(estado.sel, 0, tamanho(estado.sel) - 3)'), atualizaPrevia,
  ], { se: 'tamanho(estado.sel) > 0' }),
  botao('Subir', [
    def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'), def('chaveEdicao', '""'),
    def('no', `com(estado.no, concat(["spec", "raiz"], fatia(estado.sel, 0, tamanho(estado.sel) - 1)), move(obter(${RAIZ}, fatia(estado.sel, 0, tamanho(estado.sel) - 1)), ultimo(estado.sel), ultimo(estado.sel) - 1))`),
    def('sel', 'concat(fatia(estado.sel, 0, tamanho(estado.sel) - 1), [ultimo(estado.sel) - 1])'), atualizaPrevia,
  ], { se: 'tamanho(estado.sel) > 0 && ultimo(estado.sel) > 0' }),
  botao('Descer', [
    def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'), def('chaveEdicao', '""'),
    def('no', `com(estado.no, concat(["spec", "raiz"], fatia(estado.sel, 0, tamanho(estado.sel) - 1)), move(obter(${RAIZ}, fatia(estado.sel, 0, tamanho(estado.sel) - 1)), ultimo(estado.sel), ultimo(estado.sel) + 1))`),
    def('sel', 'concat(fatia(estado.sel, 0, tamanho(estado.sel) - 1), [ultimo(estado.sel) + 1])'), atualizaPrevia,
  ], { se: `tamanho(estado.sel) > 0 && ultimo(estado.sel) < tamanho(obter(${RAIZ}, fatia(estado.sel, 0, tamanho(estado.sel) - 1))) - 1` }),
], { se: `estado.no && ${EH_PAGINA}`, props: { gap: 4 } })

const editorDePaginas = (): Inst => pilha([
  titulo('Página {estado.aberto.id}', 3),
  barraDeBloco(),
  P('layout/grade', { props: { colunas: 3, gap: 12 }, filhos: [
    arvore(),
    pilha([titulo('Pré-visualização', 4), P('midia/quadro', { props: { titulo: 'Pré-visualização da página', html: '{previa.html}', altura: 480 } }),
      pilha([texto('O preview não compila:', { props: {} }), P('lista/lista', { filhos: [P('lista/item', { repetir: { cada: 'previa.erros', como: 'e', chave: 'e' }, filhos: [texto('{e}')] })] })], { se: 'previa && previa.ok == false', gap: 2 })], { gap: 4 }),
    propriedades(),
  ] }),
], { se: `estado.no && ${EH_PAGINA} && estado.aba == "editor"`, gap: 8 })

// ---- histórico, diff e comentários -------------------------------------------------------------------------------------------------------------
const KI = { kind: '{estado.aberto.kind}', id: '{estado.aberto.id}' }
const diffVista = (): Inst => pilha([
  texto('Sem diferenças.', { se: 'diff.diff.igual' }),
  pilha([
    texto('{m.tipo} {m.rotulo}{m.descendentes ? " (com " + m.descendentes + " bloco(s) dentro)" : ""}{m.tipo == "movido" ? " de " + m.de + " para " + m.para : ""}', { props: {} }),
    texto('   {c.tipo} {junta(c.caminho, ".")}: {texto(c.antes)} → {texto(c.depois)}', { repetir: { cada: 'm.campos ?? []', como: 'c', chave: 'junta(c.caminho, ".") + c.tipo' } }),
  ], { repetir: { cada: 'diff.diff.blocos', como: 'm', chave: 'm.tipo + m.rotulo' }, gap: 0 }),
  texto('{c.tipo} {junta(c.caminho, ".")}: {texto(c.antes)} → {texto(c.depois)}', { repetir: { cada: 'diff.diff.campos', como: 'c', chave: 'junta(c.caminho, ".") + c.tipo' } }),
], { se: 'diff && diff.diff', gap: 2 })

const comentariosVista = (): Inst => pilha([
  titulo('Comentários', 4),
  texto('Nenhum comentário.', { se: 'tamanho(comentarios.comentarios ?? []) == 0' }),
  linha([
    texto('{k.respondeA ? "↳ " : ""}{k.autor}{k.ancora ? " #" + k.ancora : ""}{k.resolvido ? " (resolvido)" : ""}: {k.texto}'),
    botao('Responder', [def('respondendo', 'k.id')], { se: '!k.respondeA' }),
    botao('{k.resolvido ? "Reabrir" : "Resolver"}', [exe('resolver', { cid: '{k.id}', resolvido: '{!k.resolvido}' }, [exe('comentarios', KI)], aviso('erro', 'erro'))], { se: '!k.respondeA' }),
  ], { repetir: { cada: 'comentarios.comentarios ?? []', como: 'k', chave: 'k.id' } }),
  texto('Respondendo a um comentário.', { se: 'estado.respondendo != ""' }),
  P('entrada/area', { props: { valor: '{estado.novoComentario}', rotulo: 'Comentário', linhas: 3 }, eventos: { aoMudar: [def('novoComentario', 'evento')] } }),
  botao('Comentar', [exe('comentar', { ...KI, texto: '{estado.novoComentario}', ancora: `{estado.respondendo == "" && ${EH_PAGINA} ? (${SELNO}.id ?? "") : ""}`, respondeA: '{estado.respondendo}' }, [def('novoComentario', '""'), def('respondendo', '""'), exe('comentarios', KI)], aviso('erro', 'erro'))], { se: 'estado.novoComentario != ""' }),
], { gap: 4 })

const historicoVista = (): Inst => pilha([
  titulo('Versões de {estado.aberto.id}', 3),
  texto('Sem versões do tenant: o nó é o padrão da plataforma.', { se: 'tamanho(versoes.versoes ?? []) == 0' }),
  linha([
    texto('v{v.seq} · {v.autor} · {v.criadoEm} · {v.nota ?? ""}{v.removido ? " (restaurou o padrão)" : ""}'),
    botao('De', [def('de', 'texto(v.seq)')]), botao('Para', [def('para', 'texto(v.seq)')]),
    botao('Restaurar no editor', [exe('versao', { ...KI, seq: '{v.seq}' }, [...edita('com(resultado.no, ["versao"], estado.no.versao)'), def('aba', '"editor"')], aviso('erro', 'erro'))], { se: '!v.removido' }),
  ], { repetir: { cada: 'versoes.versoes ?? []', como: 'v', chave: 'texto(v.seq)' } }),
  texto('Comparar: {estado.de == "base" ? "o padrão" : "v" + estado.de} → {estado.para == "base" ? "o padrão" : "v" + estado.para}', { se: 'estado.de != "" || estado.para != ""' }),
  botao('Comparar versões', [exe('diff', { ...KI, de: '{estado.de}', para: '{estado.para}' }, undefined, aviso('erro', 'erro'))], { se: 'estado.de != "" && estado.para != ""' }),
  botao('Comparar com o padrão', [def('de', '"base"'), def('para', 'texto(estado.aberto.seq)'), exe('diff', { ...KI, de: 'base', para: '{estado.aberto.seq}' }, undefined, aviso('erro', 'erro'))], { se: 'estado.aberto.origem == "tenant"' }),
  diffVista(),
  comentariosVista(),
], { se: 'estado.no && estado.aberto.origem != "novo" && estado.aba == "historico"', gap: 8 })

// ---- criar nós novos ----------------------------------------------------------------------------------------------------------------------------
const criar = (kind: 'pagina' | 'tema'): Inst => linha([
  botao(kind === 'pagina' ? 'Nova página' : 'Novo tema', [def('criando', q(kind))]),
], { props: { gap: 4 } })
const formCriar = (): Inst => linha([
  P('entrada/texto', { props: { valor: '{estado.novoId}', rotulo: 'Identificador do novo nó', placeholder: 'identificador' }, eventos: { aoMudar: [def('novoId', 'evento')] } }),
  P('entrada/texto', { se: 'estado.criando == "pagina"', props: { valor: '{estado.novaRota}', rotulo: 'Rota da nova página', placeholder: '/rota' }, eventos: { aoMudar: [def('novaRota', 'evento')] } }),
  botao('Criar', [
    def('aberto', 'objeto([["kind", estado.criando], ["id", estado.novoId], ["origem", "novo"], ["seq", null]])'),
    def('no', 'estado.criando == "pagina" ? objeto([["kind", "pagina"], ["id", estado.novoId], ["versao", "1.0.0"], ["estatuto", "rascunho"], ["spec", objeto([["rota", estado.novaRota], ["raiz", objeto([["bloco", "layout/pilha"], ["id", "raiz"]])]])]]) : objeto([["kind", "tema"], ["id", estado.novoId], ["versao", "1.0.0"], ["estatuto", "rascunho"], ["spec", objeto([["tokens", objeto([["cor", objeto([["fundo", "#ffffff"], ["texto", "#111111"], ["primaria", "#1d4ed8"]])]])]])]])'),
    def('noSalvo', 'null'), def('passado', '[]'), def('futuro', '[]'), def('chaveEdicao', '""'), def('sel', '[]'), def('aviso', '""'), def('aba', '"editor"'), def('criando', '""'), atualizaPrevia,
  ], { se: 'estado.novoId != ""' }),
  botao('Cancelar', [def('criando', '""')]),
], { se: 'estado.criando != ""', props: { gap: 4 } })

export const PAGINA = no('pagina', 'studio.app', {
  rota: '/studio', titulo: 'Polaris Studio',
  dados: { nos: 'studio.nos', blocos: 'studio.blocos', abrir: 'studio.abrir', salvar: 'studio.salvar', previa: 'studio.previa', versoes: 'studio.versoes', versao: 'studio.versao', diff: 'studio.diff', comentarios: 'studio.comentarios', comentar: 'studio.comentar', resolver: 'studio.resolver', publicar: 'studio.publicar', site: 'studio.site', definetema: 'studio.definetema' },
  estado: {
    criando: { tipo: 'texto', inicial: '' }, novoId: { tipo: 'texto', inicial: '' }, novaRota: { tipo: 'texto', inicial: '/' }, novoTokenNome: { tipo: 'texto', inicial: '' }, novoTokenValor: { tipo: 'texto', inicial: '' },
    aba: { tipo: 'texto', inicial: 'editor' }, de: { tipo: 'texto', inicial: '' }, para: { tipo: 'texto', inicial: '' }, novoComentario: { tipo: 'texto', inicial: '' }, respondendo: { tipo: 'texto', inicial: '' },
    aberto: { tipo: 'json' }, no: { tipo: 'json' }, noSalvo: { tipo: 'json' }, passado: { tipo: 'json', inicial: [] }, futuro: { tipo: 'json', inicial: [] }, chaveEdicao: { tipo: 'texto', inicial: '' },
    sel: { tipo: 'json', inicial: [] }, contador: { tipo: 'inteiro', inicial: 1 }, aviso: { tipo: 'texto', inicial: '' }, tipoAviso: { tipo: 'texto', inicial: 'neutro' }, amostra: { tipo: 'json', inicial: AMOSTRA },
  },
  raiz: pilha([
    linha([
      titulo('Polaris Studio', 1),
      botao('Desfazer', desfaz, { se: 'estado.no && tamanho(estado.passado) > 0' }), botao('Refazer', refaz, { se: 'estado.no && tamanho(estado.futuro) > 0' }),
      botao('Salvar', [exe('salvar', { kind: '{estado.aberto.kind}', id: '{estado.aberto.id}', no: '{estado.no}', baseSeq: '{estado.aberto.seq}' }, [
        def('aberto', 'com(com(estado.aberto, ["seq"], resultado.versao.seq), ["origem"], "tenant")'), def('noSalvo', 'estado.no'), ...aviso('sucesso', '"Salvo como versão " + resultado.versao.seq'), exe('nos'), ...carregaLateral('{estado.aberto.kind}', 'estado.aberto.id'),
      ], aviso('erro', 'erro'))], { se: 'estado.no' }),
      botao('Publicar', [exe('publicar', {}, [...aviso('sucesso', '"Publicado: release " + resultado.release + ". O site já usa as versões salvas."')], aviso('erro', 'erro'))]),
      texto('{estado.no ? (igual(estado.no, estado.noSalvo) ? (estado.aberto.origem == "base" ? "padrão da plataforma" : "salvo (v" + estado.aberto.seq + ")") : "● alterações não salvas") : ""}'),
    ]),
    ...(['sucesso', 'erro', 'neutro'] as const).map((tom) => P('feedback/alerta', { se: `estado.aviso && estado.tipoAviso == ${q(tom)}`, props: { tom }, filhos: [texto('{estado.aviso}')] })),
    linha([criar('pagina'), criar('tema')]), formCriar(),
    seletorDeNos('pagina'),
    seletorDeNos('tema'),
    linha([botao('Editor', [def('aba', '"editor"')]), botao('Histórico e comentários', [def('aba', '"historico"')])], { se: 'estado.no && estado.aberto.origem != "novo"' }),
    editorDePaginas(),
    editorDeTema(),
    historicoVista(),
  ], { gap: 12 }),
})

export const NOS_DO_STUDIO = [...DADOS, PAGINA]
