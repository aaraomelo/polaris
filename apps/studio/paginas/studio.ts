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
  dado('releases', 'listarReleases', {}),
  dado('linkprev', 'linkDePreview', { release: campo('inteiro', { obrigatorio: true }), horas: campo('inteiro') }),
  dado('voltar', 'voltarRelease', { para: campo('inteiro'), nota: campo('texto') }),
  dado('diffrel', 'compararReleases', { de: campo('inteiro', { obrigatorio: true }), para: campo('inteiro', { obrigatorio: true }) }),
  dado('publicar', 'publicarSite', { nota: campo('texto') }),
  dado('diagrama', 'diagramar', { tipo: campo('texto', { obrigatorio: true }), no: campo('json'), selecionado: campo('texto') }),
  dado('previa', 'previsualizar', { no: campo('json', { obrigatorio: true }), tema: campo('json'), selecionado: campo('texto'), modo: campo('texto') }),
  dado('restaurar', 'restaurarPadrao', { kind: campo('texto', { obrigatorio: true }), id: campo('texto', { obrigatorio: true }) }),
]

/** a página que o editor de tema usa como amostra */
const AMOSTRA = { kind: 'pagina', id: 'amostra', versao: '1.0.0', spec: { rota: '/amostra', raiz: { bloco: 'layout/pilha', props: { gap: 12 }, slots: { filhos: [
  { bloco: 'texto/titulo', props: { texto: 'Título de exemplo', nivel: 1 } }, { bloco: 'texto/paragrafo', props: { texto: 'Um parágrafo com o texto principal do tema.' } },
  { bloco: 'texto/pequeno', props: { texto: 'Texto suave, menor.' } }, { bloco: 'nav/botao', props: { texto: 'Botão' } },
  { bloco: 'feedback/selo', props: { texto: 'Sucesso', tom: 'sucesso' } }, { bloco: 'feedback/selo', props: { texto: 'Alerta', tom: 'alerta' } }, { bloco: 'feedback/selo', props: { texto: 'Erro', tom: 'erro' } },
] } } } }

// ---- pedaços de expressão que se repetem --------------------------------------------------------------------------------------------------------
const EH_PAGINA = 'estado.aberto.kind == "pagina"', EH_TEMA = 'estado.aberto.kind == "tema"', EH_FORM = 'estado.aberto.kind == "formulario"'
const RAIZ = 'estado.no.spec.raiz', SELNO = `obter(${RAIZ}, estado.sel)`, DOCSEL = 'concat(["spec", "raiz"], estado.sel)'
const DEFBLOCO = `acha(blocos.blocos, b => b.id == ${SELNO}.bloco)`

const aviso = (tipo: 'sucesso' | 'erro' | 'neutro', msg: string): Acao[] => [def('tipoAviso', q(tipo)), def('aviso', msg)]
/** a prévia: de uma página, o RASCUNHO (com o bloco selecionado destacado); de um tema, a página de amostra com o tema aplicado */
const atualizaPrevia: Acao = exe('previa', {
  no: `{(${EH_PAGINA} || ${EH_FORM}) ? estado.no : estado.amostra}`, tema: `{${EH_TEMA} ? estado.no : null}`, selecionado: `{${EH_PAGINA} ? (${SELNO}.id ?? "") : ${EH_FORM} ? estado.passoPrevia : ""}`, modo: '{estado.modoPrevia}',
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
const abrirX = (kindExpr: string, id: string): Acao => exe('abrir', { kind: `{${kindExpr}}`, id: `{${id}}` }, [
  def('aberto', `objeto([["kind", ${kindExpr}], ["id", ${id}], ["origem", resultado.origem], ["seq", resultado.seq]])`), def('no', 'resultado.no'), def('noSalvo', 'resultado.no'),
  def('passado', '[]'), def('futuro', '[]'), def('chaveEdicao', '""'), def('sel', '[]'), def('aviso', '""'), def('aba', '"editor"'), def('de', '""'), def('para', '""'), def('pendente', 'null'), def('confirmaRestaurar', 'false'), def('selCampo', '[]'), def('abaForm', '"campos"'), def('passoPrevia', '""'), def('jsonTexto', '""'), def('jsonErro', '""'), atualizaPrevia, ...carregaLateral(`{${kindExpr}}`, id),
], aviso('erro', 'erro'))
const abrir = (kind: string, id: string): Acao => abrirX(q(kind), id)
const SUJO = 'estado.no && !igual(estado.no, estado.noSalvo)'

/** com alterações não salvas, abrir outro nó pede confirmação (a barra abaixo do seletor); sem elas, abre direto */
const pede = (kind: string, id: string): Acao => def('pendente', `objeto([["kind", ${q(kind)}], ["id", ${id}]])`)
const barraPendente = (): Inst => linha([
  texto('Há alterações não salvas em {estado.aberto.id}. Descartar e abrir {estado.pendente.id}?'),
  botao('Descartar e abrir', [abrirX('estado.pendente.kind', 'estado.pendente.id')]), botao('Continuar editando', [def('pendente', 'null')]),
], { se: 'estado.pendente && ' + SUJO, props: { gap: 8 } })
const seletorDeNos = (kind: 'tema' | 'pagina' | 'formulario'): Inst => pilha([
  titulo(kind === 'tema' ? 'Temas' : kind === 'pagina' ? 'Páginas' : 'Formulários', 3),
  linha([
    P('layout/linha', { repetir: { cada: `filtra(nos.nos, n => n.kind == ${q(kind)})`, como: 'n', chave: 'n.id' }, props: { gap: 4 }, filhos: [botao('{n.id} (personalizado)', [abrir(kind, 'n.id')], { se: `!(${SUJO})` }), botao('{n.id} (personalizado)', [pede(kind, 'n.id')], { se: SUJO })] }),
    P('layout/linha', { repetir: { cada: `filtra(nos.base.${kind}, b => !comeca(b, "studio.") && tamanho(filtra(nos.nos, n => n.kind == ${q(kind)} && n.id == b)) == 0)`, como: 'b', chave: 'b' }, props: { gap: 4 }, filhos: [botao('{b} (padrão)', [abrir(kind, 'b')], { se: `!(${SUJO})` }), botao('{b} (padrão)', [pede(kind, 'b')], { se: SUJO })] }),
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
    texto('Tema do site: {site.tema ?? "padrao (o padrão da plataforma)"}', { se: 'site.configuravel' }),
    botao('Usar este tema no site', [exe('definetema', { tema: '{estado.aberto.id}' }, [...aviso('sucesso', '"Tema do site: " + resultado.tema + ". Publique para o site mudar."'), exe('site')], aviso('erro', 'erro'))],
      { se: 'site.configuravel && igual(estado.no, estado.noSalvo) && estado.aberto.origem != "novo" && site.tema != estado.aberto.id' }),
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


// ---- editor de formulários ---------------------------------------------------------------------------------------------------------------------
const CAMPOSEL = 'obter(estado.no.spec, estado.selCampo)', DOCC = 'concat(["spec"], estado.selCampo)'
const PAI_CAMPOS = 'fatia(estado.selCampo, 0, tamanho(estado.selCampo) - 1)'
const TIPOS_CAMPO = ['texto', 'textoLongo', 'senha', 'email', 'telefone', 'url', 'numero', 'inteiro', 'dinheiro', 'percentual', 'booleano', 'escolha', 'multiescolha', 'data', 'hora', 'dataHora', 'cpf', 'cnpj', 'cep', 'arquivo', 'oculto', 'grupo', 'lista']
const PALETA = ['texto', 'textoLongo', 'email', 'telefone', 'cpf', 'cnpj', 'cep', 'numero', 'dinheiro', 'data', 'booleano', 'escolha', 'multiescolha', 'senha', 'grupo', 'lista']
const lit = (caminho: string[]) => `[${caminho.map(q).join(', ')}]`
/** entrada de texto de uma propriedade do campo selecionado (caminho relativo ao campo); vazio remove a propriedade */
const propTexto = (rotulo: string, caminho: string[], opc: { numero?: boolean; se?: string } = {}): Inst => P('entrada/texto', {
  ...(opc.se ? { se: opc.se } : {}), props: { valor: `{texto(obter(${CAMPOSEL}, ${lit(caminho)}) ?? "")}`, rotulo },
  eventos: { aoMudar: edita(`evento == "" ? sem(estado.no, concat(${DOCC}, ${lit(caminho)})) : com(estado.no, concat(${DOCC}, ${lit(caminho)}), ${opc.numero ? '(paraNumero(evento) ?? evento)' : 'evento'})`, `"fc:" + junta(estado.selCampo, ".") + ".${caminho.join('.')}"`) },
})
const propCaixa = (rotulo: string, caminho: string[], opc: { se?: string } = {}): Inst => P('entrada/caixa', {
  ...(opc.se ? { se: opc.se } : {}), props: { marcado: `{obter(${CAMPOSEL}, ${lit(caminho)}) == true}`, rotulo },
  eventos: { aoMudar: edita(`evento ? com(estado.no, concat(${DOCC}, ${lit(caminho)}), true) : sem(estado.no, concat(${DOCC}, ${lit(caminho)}))`) },
})
const TIPO_C = `(${CAMPOSEL}).tipo`
const TEXTUAIS = '(' + ['texto', 'textoLongo', 'senha', 'email', 'telefone', 'url', 'cpf', 'cnpj', 'cep'].map((t) => `${TIPO_C} == "${t}"`).join(' || ') + ')'
const NUMERICOS = '(' + ['numero', 'inteiro', 'dinheiro', 'percentual'].map((t) => `${TIPO_C} == "${t}"`).join(' || ') + ')'
const COM_MASCARA = '(' + ['texto', 'textoLongo', 'email', 'telefone', 'url', 'numero', 'inteiro', 'data', 'hora', 'dataHora', 'cpf', 'cnpj', 'cep'].map((t) => `${TIPO_C} == "${t}"`).join(' || ') + ')'
const LISTA_CAMPOS = `filtra(percorre(estado.no.spec, "campos"), x => tamanho(x.caminho) > 0)`
const NOVO_CAMPO = (t: string) => `mescla(objeto([["nome", "campo" + estado.contador], ["tipo", ${q(t)}], ["rotulo", "Campo " + estado.contador]]), ${t === 'escolha' || t === 'multiescolha' ? 'objeto([["opcoes", [objeto([["valor", "a"], ["rotulo", "Opção A"]]), objeto([["valor", "b"], ["rotulo", "Opção B"]])]]])' : t === 'grupo' || t === 'lista' ? 'objeto([["campos", [objeto([["nome", "item"], ["tipo", "texto"], ["rotulo", "Item"]])]]])' : 'objeto([])'})`
/** onde o campo novo entra: dentro do grupo/lista selecionado, ou no fim da lista principal */
const CAMINHO_NOVOS = `(tamanho(estado.selCampo) > 0 && ((${TIPO_C} == "grupo") || (${TIPO_C} == "lista")) ? concat(${DOCC}, ["campos"]) : ["spec", "campos"])`

const listaDeCampos = (): Inst => pilha([
  titulo('Campos', 4),
  pilha([botao('{(tamanho(x.caminho) > 2 ? junta(mapeia(intervalo(0, tamanho(x.caminho) / 2 - 1), i => "· "), "") : "") + (igual(x.caminho, estado.selCampo) ? "▶ " : "") + x.no.nome + " (" + x.no.tipo + ")" + (x.no.obrigatorio ? " *" : "")}', [def('selCampo', 'x.caminho')])],
    { repetir: { cada: LISTA_CAMPOS, como: 'x', chave: 'junta(mapeia(x.caminho, p => texto(p)), ".")' }, gap: 2 }),
  texto('Nenhum campo ainda: use a paleta.', { se: `tamanho(estado.no.spec.campos ?? []) == 0` }),
  titulo('Adicionar campo', 5),
  P('layout/grade', { props: { colunas: 2, gap: 4 }, filhos: PALETA.map((t) => botao(`+ ${t}`, [
    def('chaveEdicao', '""'), def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'),
    def('no', `com(estado.no, ${CAMINHO_NOVOS}, concat(obter(estado.no, ${CAMINHO_NOVOS}) ?? [], [${NOVO_CAMPO(t)}]))`), def('contador', 'estado.contador + 1'), atualizaPrevia,
  ])) }),
], { gap: 4 })

const barraDeCampo = (): Inst => linha([
  botao('Remover', [def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'), def('chaveEdicao', '""'), def('no', `sem(estado.no, ${DOCC})`), def('selCampo', `fatia(estado.selCampo, 0, tamanho(estado.selCampo) - 2)`), atualizaPrevia], { se: 'tamanho(estado.selCampo) > 0' }),
  botao('Subir', [def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'), def('chaveEdicao', '""'),
    def('no', `com(estado.no, concat(["spec"], ${PAI_CAMPOS}), move(obter(estado.no.spec, ${PAI_CAMPOS}), ultimo(estado.selCampo), ultimo(estado.selCampo) - 1))`), def('selCampo', `concat(${PAI_CAMPOS}, [ultimo(estado.selCampo) - 1])`), atualizaPrevia], { se: 'tamanho(estado.selCampo) > 0 && ultimo(estado.selCampo) > 0' }),
  botao('Descer', [def('passado', 'fatia(concat(estado.passado, [estado.no]), -60)'), def('futuro', '[]'), def('chaveEdicao', '""'),
    def('no', `com(estado.no, concat(["spec"], ${PAI_CAMPOS}), move(obter(estado.no.spec, ${PAI_CAMPOS}), ultimo(estado.selCampo), ultimo(estado.selCampo) + 1))`), def('selCampo', `concat(${PAI_CAMPOS}, [ultimo(estado.selCampo) + 1])`), atualizaPrevia],
    { se: `tamanho(estado.selCampo) > 0 && ultimo(estado.selCampo) < tamanho(obter(estado.no.spec, ${PAI_CAMPOS})) - 1` }),
], { se: 'estado.no', props: { gap: 4 } })

const propriedadesDoCampo = (): Inst => pilha([
  titulo('Campo {(' + CAMPOSEL + ').nome}', 4),
  propTexto('Nome (chave do valor)', ['nome']), propTexto('Rótulo', ['rotulo']), propTexto('Ajuda', ['ajuda']), propTexto('Placeholder', ['placeholder']),
  texto('Tipo', { props: {} }),
  P('layout/grade', { props: { colunas: 3, gap: 2 }, filhos: [botao('{t}{' + TIPO_C + ' == t ? " ✓" : ""}', edita(`com(estado.no, concat(${DOCC}, ["tipo"]), t)`), { repetir: { cada: lit(TIPOS_CAMPO), como: 't', chave: 't' } } as never)] }),
  propCaixa('Obrigatório', ['obrigatorio']), propTexto('Obrigatório se (expressão)', ['obrigatorioSe']), propTexto('Exibir se (expressão)', ['se']), propTexto('Valor padrão', ['padrao']),
  pilha([
    titulo('Máscara', 5),
    P('entrada/texto', { props: { valor: `{(${CAMPOSEL}).mascara ? (tamanho(texto((${CAMPOSEL}).mascara.padrao)) > 0 && igual(texto((${CAMPOSEL}).mascara.padrao), (${CAMPOSEL}).mascara.padrao) ? (${CAMPOSEL}).mascara.padrao : junta((${CAMPOSEL}).mascara.padrao, " | ")) : ""}`, rotulo: 'Padrão (0 dígito · 9 opcional · A letra · a letra/dígito · * qualquer; várias separadas por |)' },
      eventos: { aoMudar: edita(`aparar(evento) == "" ? sem(estado.no, concat(${DOCC}, ["mascara"])) : com(estado.no, concat(${DOCC}, ["mascara", "padrao"]), tamanho(divide(evento, "|")) > 1 ? mapeia(divide(evento, "|"), t => aparar(t)) : aparar(evento))`, `"mp:" + junta(estado.selCampo, ".")`) } }),
    propCaixa('Enviar com os literais (ex.: 123.456.789-01)', ['mascara', 'enviaComLiterais'], { se: `${CAMPOSEL}.mascara` }),
  ], { se: COM_MASCARA, gap: 2 }),
  pilha([
    titulo('Validação', 5),
    propTexto('Tamanho mínimo', ['validacao', 'tamanhoMinimo'], { numero: true, se: TEXTUAIS }), propTexto('Tamanho máximo', ['validacao', 'tamanhoMaximo'], { numero: true, se: TEXTUAIS }),
    propTexto('Expressão regular (valor inteiro)', ['validacao', 'padrao'], { se: TEXTUAIS }),
    propTexto('Mínimo', ['validacao', 'minimo'], { se: NUMERICOS }), propTexto('Máximo', ['validacao', 'maximo'], { se: NUMERICOS }),
    propTexto('Deve ser igual ao campo', ['validacao', 'igualA']),
  ], { gap: 2 }),
  pilha([
    titulo('Opções (uma por linha: valor | rótulo)', 5),
    P('entrada/area', { props: { valor: `{junta(mapeia(obter(${CAMPOSEL}, ["opcoes"]) ?? [], o => texto(o.valor) + " | " + (o.rotulo ?? "")), "\\n")}`, rotulo: 'Opções', linhas: 4 },
      eventos: { aoMudar: edita(`com(estado.no, concat(${DOCC}, ["opcoes"]), mapeia(filtra(divide(evento, "\\n"), l => aparar(l) != ""), l => mescla(objeto([["valor", aparar(divide(l, "|")[0])]]), tamanho(divide(l, "|")) > 1 && aparar(divide(l, "|")[1]) != "" ? objeto([["rotulo", aparar(divide(l, "|")[1])]]) : objeto([]))))`, `"op:" + junta(estado.selCampo, ".")`) } }),
  ], { se: `${TIPO_C} == "escolha" || ${TIPO_C} == "multiescolha"`, gap: 2 }),
  titulo('Mensagens de erro deste campo', 5),
  propTexto('Obrigatório', ['mensagens', 'obrigatorio']), propTexto('Formato', ['mensagens', 'formato']), propTexto('Tamanho mínimo', ['mensagens', 'tamanhoMinimo'], { se: TEXTUAIS }), propTexto('Mínimo', ['mensagens', 'minimo'], { se: NUMERICOS }),
], { se: `estado.no && ${EH_FORM} && tamanho(estado.selCampo) > 0 && ${CAMPOSEL}`, gap: 4 })

const propForm = (rotulo: string, caminho: string[]): Inst => P('entrada/texto', { props: { valor: `{texto(obter(estado.no.spec, ${lit(caminho)}) ?? "")}`, rotulo },
  eventos: { aoMudar: edita(`evento == "" ? sem(estado.no, concat(["spec"], ${lit(caminho)})) : com(estado.no, concat(["spec"], ${lit(caminho)}), evento)`, `"ff:${caminho.join('.')}"`) } })

const painelDoFormulario = (): Inst => pilha([
  titulo('Formulário', 4), propForm('Título', ['titulo']), propForm('Descrição', ['descricao']),
  titulo('Envio', 5), propForm('Serviço', ['envio', 'servico']), propForm('Operação (ex.: criarContato)', ['envio', 'operacao']), propForm('Mensagem de sucesso', ['envio', 'sucesso', 'mensagem']),
  texto('Seções, passos, ações, regras entre campos e mensagens gerais: aba JSON.'),
], { gap: 4 })

const problemasVista = (): Inst => pilha([
  texto('{tamanho(previa.problemas ?? []) == 0 ? "Definição coerente: sem problemas." : tamanho(previa.problemas) + " problema(s):"}'),
  texto('• {p}', { repetir: { cada: 'previa.problemas ?? []', como: 'p', chave: 'p' } }),
], { se: 'previa && previa.ok', gap: 2 })

const abaCampos = (): Inst => pilha([
  barraDeCampo(),
  P('layout/grade', { props: { colunas: 3, gap: 12 }, filhos: [
    pilha([listaDeCampos(), painelDoFormulario()], { gap: 12 }),
    pilha([
      titulo('Pré-visualização (sem comportamento)', 4),
      linha([botao('{p.titulo}{estado.passoPrevia == p.id || (estado.passoPrevia == "" && p.x == 0) ? " ✓" : ""}', [def('passoPrevia', 'p.id'), atualizaPrevia], { repetir: { cada: 'mapeia(estado.no.spec.passos ?? [], (p, x) => mescla(p, objeto([["x", x]])))', como: 'p', chave: 'p.id' } } as never)], { se: 'tamanho(estado.no.spec.passos ?? []) > 0', props: { gap: 4 } }),
      P('midia/quadro', { props: { titulo: 'Pré-visualização do formulário', html: '{previa.html}', altura: 520 } }),
      problemasVista(),
      pilha([texto('A prévia não pôde ser gerada:'), texto('{e}', { repetir: { cada: 'previa.erros', como: 'e', chave: 'e' } })], { se: 'previa && previa.ok == false', gap: 2 }),
    ], { gap: 4 }),
    propriedadesDoCampo(),
  ] }),
], { gap: 8 })

const abaTeste = (): Inst => pilha([
  titulo('Teste com valores de exemplo', 4),
  texto('Cole os valores como o visitante os digitaria (JSON). O resultado é o do validador real do servidor: valores normalizados, mensagens e erros.'),
  P('entrada/area', { props: { valor: '{estado.valoresTeste}', rotulo: 'Valores de exemplo (JSON)', linhas: 8 }, eventos: { aoMudar: [def('valoresTeste', 'evento')] } }),
  texto('JSON inválido: use um objeto (nomes e textos entre aspas).', { se: '(analisaJson(estado.valoresTeste) ?? "ruim") == "ruim"' }),
  pilha([
    titulo('{validaFormulario(estado.no.spec, analisaJson(estado.valoresTeste), "pt-BR").ok ? "Válido" : "Com erros"}', 5),
    texto('{e.campo}: {e.mensagem} ({e.regra})', { repetir: { cada: 'validaFormulario(estado.no.spec, analisaJson(estado.valoresTeste), "pt-BR").erros', como: 'e', chave: 'e.campo + e.regra' } }),
    titulo('Valores normalizados', 5),
    P('entrada/area', { props: { valor: '{paraJson(validaFormulario(estado.no.spec, analisaJson(estado.valoresTeste), "pt-BR").valores, 2)}', rotulo: 'Valores normalizados', linhas: 8, desabilitado: true } }),
  ], { se: 'validaFormulario(estado.no.spec, analisaJson(estado.valoresTeste), "pt-BR")', gap: 4 }),
], { gap: 6 })

const abaJson = (): Inst => pilha([
  titulo('JSON da definição', 4),
  texto('Para o que a tela não cobre (seções, passos, ações, regras entre campos, mensagens gerais). Edite e clique em Aplicar.'),
  P('entrada/area', { props: { valor: '{estado.jsonTexto}', rotulo: 'spec do formulário', linhas: 24 }, eventos: { aoMudar: [def('jsonTexto', 'evento'), def('jsonErro', '""')] } }),
  linha([
    botao('Aplicar', [def('jsonErro', 'tamanho(chaves(analisaJson(estado.jsonTexto) ?? objeto([]))) == 0 ? "JSON inválido (use um objeto)." : (obter(analisaJson(estado.jsonTexto), ["campos"]) ? "" : "A definição precisa de `campos`.")'),
      def('passado', 'estado.jsonErro == "" ? fatia(concat(estado.passado, [estado.no]), -60) : estado.passado'), def('futuro', 'estado.jsonErro == "" ? [] : estado.futuro'),
      def('no', 'estado.jsonErro == "" ? com(estado.no, ["spec"], analisaJson(estado.jsonTexto)) : estado.no'), def('selCampo', 'estado.jsonErro == "" ? [] : estado.selCampo'), atualizaPrevia]),
    botao('Recarregar do rascunho', [def('jsonTexto', 'paraJson(estado.no.spec, 2)'), def('jsonErro', '""')]),
  ], { props: { gap: 8 } }),
  texto('{estado.jsonErro}', { se: 'estado.jsonErro != ""' }),
], { gap: 6 })

const editorDeFormularios = (): Inst => pilha([
  titulo('Formulário {estado.aberto.id}', 3),
  linha([
    botao('Campos', [def('abaForm', '"campos"')]), botao('Testar', [def('abaForm', '"teste"')]), botao('JSON', [def('abaForm', '"json"'), def('jsonTexto', 'paraJson(estado.no.spec, 2)'), def('jsonErro', '""')]),
    texto('({estado.abaForm})'),
  ], { props: { gap: 8 } }),
  pilha([abaCampos()], { se: 'estado.abaForm == "campos"' }),
  pilha([abaTeste()], { se: 'estado.abaForm == "teste"' }),
  pilha([abaJson()], { se: 'estado.abaForm == "json"' }),
], { se: `estado.no && ${EH_FORM} && estado.aba == "editor"`, gap: 8 })

// ---- histórico, diff e comentários -------------------------------------------------------------------------------------------------------------
const KI = { kind: '{estado.aberto.kind}', id: '{estado.aberto.id}' }
const releasesVista = (): Inst => pilha([
  titulo('Releases', 3),
  texto('Em produção: {releases.producao ? "release " + releases.producao : "nenhuma (o site usa só o padrão da plataforma)"}'),
  botao('Voltar para a anterior (release {releases.anterior})', [exe('voltar', {}, [...aviso('sucesso', '"Em produção: release " + resultado.producao + ". O site já usa esta versão."'), exe('releases')], aviso('erro', 'erro'))], { se: 'releases.anterior' }),
  texto('Nenhuma release ainda: use Publicar.', { se: 'tamanho(releases.releases ?? []) == 0' }),
  linha([
    texto('release {r.numero} · {r.autor} · {r.criadoEm} · {r.nos} nós{r.nota ? " · " + r.nota : ""}{r.numero == releases.producao ? " · EM PRODUÇÃO" : ""}'),
    botao('Diferenças com a produção', [exe('diffrel', { de: '{releases.producao}', para: '{r.numero}' }, undefined, aviso('erro', 'erro'))], { se: 'releases.producao && r.numero != releases.producao' }),
    botao('Link de pré-visualização', [exe('linkprev', { release: '{r.numero}' }, [def('linkPrevia', 'objeto([["release", r.numero], ["caminho", resultado.caminho], ["horas", resultado.expiraEmHoras]])')], aviso('erro', 'erro'))]),
    botao('Voltar para esta', [exe('voltar', { para: '{r.numero}' }, [...aviso('sucesso', '"Em produção: release " + resultado.producao + ". O site já usa esta versão."'), exe('releases')], aviso('erro', 'erro'))], { se: 'r.numero != releases.producao' }),
  ], { repetir: { cada: 'releases.releases ?? []', como: 'r', chave: 'texto(r.numero)' } }),
  pilha([
    texto('Pré-visualização da release {estado.linkPrevia.release}: abra o link (vale {estado.linkPrevia.horas} h; quem tiver o link vê o site dessa release, sem login). Para encerrar, abra /_polaris/preview/sair.'),
    P('nav/link', { props: { href: '{estado.linkPrevia.caminho}', texto: 'Abrir a pré-visualização da release {estado.linkPrevia.release}' } }),
    texto('{estado.linkPrevia.caminho}'),
  ], { se: 'estado.linkPrevia', gap: 2 }),
  pilha([
    titulo('Diferenças (produção → esta)', 4),
    texto('Sem diferenças.', { se: 'tamanho(diffrel.adicionados ?? []) + tamanho(diffrel.removidos ?? []) + tamanho(diffrel.alterados ?? []) == 0' }),
    texto('+ {n}', { repetir: { cada: 'diffrel.adicionados ?? []', como: 'n', chave: 'n' } }), texto('− {n}', { repetir: { cada: 'diffrel.removidos ?? []', como: 'n', chave: 'n' } }), texto('~ {n}', { repetir: { cada: 'diffrel.alterados ?? []', como: 'n', chave: 'n' } }),
  ], { se: 'diffrel', gap: 2 }),
], { se: 'estado.painel == "releases" && releases', gap: 8 })

/** diagramas gerados do JSON no servidor: o fluxo do site (páginas, formulários, dados, serviços) e os blocos da página aberta (o rascunho, com o bloco selecionado em destaque) */
const diagramasVista = (): Inst => pilha([
  titulo('Diagramas', 3),
  linha([
    botao('Fluxo da aplicação', [def('tipoDiagrama', '"fluxo"'), exe('diagrama', { tipo: 'fluxo' }, undefined, aviso('erro', 'erro'))]),
    botao('Blocos da página aberta', [def('tipoDiagrama', '"blocos"'), exe('diagrama', { tipo: 'blocos', no: '{estado.no}', selecionado: `{${SELNO}.id ?? ""}` }, undefined, aviso('erro', 'erro'))], { se: `estado.no && ${EH_PAGINA}` }),
  ]),
  texto('{estado.tipoDiagrama == "fluxo" ? "Fluxo: " + diagrama.resumo.nos + " nó(s) e " + diagrama.resumo.ligacoes + " ligação(ões) — páginas → formulários → dados → serviços." : "Blocos: " + diagrama.resumo.blocos + " bloco(s) da página aberta (rascunho)."}{diagrama.resumo.truncado ? " O desenho foi cortado por ser grande." : ""}', { se: 'diagrama && diagrama.ok' }),
  P('midia/quadro', { props: { titulo: 'Diagrama', html: '{diagrama.html}', altura: 560 }, se: 'diagrama && diagrama.ok' }),
  texto('Atenção: {a}', { repetir: { cada: 'diagrama.resumo.avisos ?? []', como: 'a', chave: 'a' }, se: 'diagrama && diagrama.ok' }),
  texto('Abra um diagrama pelos botões acima.', { se: '!diagrama' }),
], { se: 'estado.painel == "diagramas"', gap: 8 })

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
const criar = (kind: 'pagina' | 'tema' | 'formulario'): Inst => linha([
  botao(kind === 'pagina' ? 'Nova página' : kind === 'tema' ? 'Novo tema' : 'Novo formulário', [def('criando', q(kind))]),
], { props: { gap: 4 } })
const ACOES_CRIAR: Acao[] = [
    def('aberto', 'objeto([["kind", estado.criando], ["id", estado.novoId], ["origem", "novo"], ["seq", null]])'),
    def('no', 'estado.criando == "formulario" ? objeto([["kind", "formulario"], ["id", estado.novoId], ["versao", "1.0.0"], ["estatuto", "rascunho"], ["spec", objeto([["titulo", estado.novoId], ["campos", [objeto([["nome", "nome"], ["tipo", "texto"], ["rotulo", "Nome"], ["obrigatorio", true]])]]])]]) : estado.criando == "pagina" ? objeto([["kind", "pagina"], ["id", estado.novoId], ["versao", "1.0.0"], ["estatuto", "rascunho"], ["spec", objeto([["rota", estado.novaRota], ["raiz", objeto([["bloco", "layout/pilha"], ["id", "raiz"]])]])]]) : objeto([["kind", "tema"], ["id", estado.novoId], ["versao", "1.0.0"], ["estatuto", "rascunho"], ["spec", objeto([["tokens", objeto([["cor", objeto([["fundo", "#ffffff"], ["texto", "#111111"], ["primaria", "#1d4ed8"]])]])]])]])'),
    def('noSalvo', 'null'), def('passado', '[]'), def('futuro', '[]'), def('chaveEdicao', '""'), def('sel', '[]'), def('aviso', '""'), def('aba', '"editor"'), def('selCampo', '[]'), def('abaForm', '"campos"'), def('passoPrevia', '""'), def('criando', '""'), atualizaPrevia, def('confirmaCriar', 'false')]
const formCriar = (): Inst => linha([
  P('entrada/texto', { props: { valor: '{estado.novoId}', rotulo: 'Identificador do novo nó', placeholder: 'identificador' }, eventos: { aoMudar: [def('novoId', 'evento')] } }),
  P('entrada/texto', { se: 'estado.criando == "pagina"', props: { valor: '{estado.novaRota}', rotulo: 'Rota da nova página', placeholder: '/rota' }, eventos: { aoMudar: [def('novaRota', 'evento')] } }),
  botao('Criar', ACOES_CRIAR, { se: `estado.novoId != "" && !(${SUJO})` }),
  botao('Criar', [def('confirmaCriar', 'true')], { se: `estado.novoId != "" && (${SUJO}) && !estado.confirmaCriar` }), // com alterações não salvas no editor, criar as descartaria: pede confirmação
  texto('Há alterações não salvas em {estado.aberto.id}; criar um novo nó as descarta.', { se: 'estado.confirmaCriar' }),
  botao('Descartar e criar', ACOES_CRIAR, { se: 'estado.novoId != "" && estado.confirmaCriar' }),
  botao('Cancelar', [def('criando', '""'), def('confirmaCriar', 'false')]),
], { se: 'estado.criando != ""', props: { gap: 4 } })

export const PAGINA = no('pagina', 'studio.app', {
  rota: '/studio', titulo: 'Polaris Studio',
  dados: { diagrama: 'studio.diagrama', nos: 'studio.nos', blocos: 'studio.blocos', abrir: 'studio.abrir', salvar: 'studio.salvar', previa: 'studio.previa', versoes: 'studio.versoes', versao: 'studio.versao', diff: 'studio.diff', comentarios: 'studio.comentarios', comentar: 'studio.comentar', resolver: 'studio.resolver', restaurar: 'studio.restaurar', publicar: 'studio.publicar', site: 'studio.site', releases: 'studio.releases', voltar: 'studio.voltar', linkprev: 'studio.linkprev', diffrel: 'studio.diffrel', definetema: 'studio.definetema' },
  estado: {
    criando: { tipo: 'texto', inicial: '' }, novoId: { tipo: 'texto', inicial: '' }, novaRota: { tipo: 'texto', inicial: '/' }, novoTokenNome: { tipo: 'texto', inicial: '' }, novoTokenValor: { tipo: 'texto', inicial: '' },
    painel: { tipo: 'texto', inicial: '' }, tipoDiagrama: { tipo: 'texto', inicial: 'fluxo' }, selCampo: { tipo: 'json', inicial: [] }, abaForm: { tipo: 'texto', inicial: 'campos' }, passoPrevia: { tipo: 'texto', inicial: '' }, valoresTeste: { tipo: 'texto', inicial: '{}' }, jsonTexto: { tipo: 'texto', inicial: '' }, jsonErro: { tipo: 'texto', inicial: '' }, linkPrevia: { tipo: 'json' }, modoPrevia: { tipo: 'texto', inicial: 'claro' }, pendente: { tipo: 'json' }, confirmaRestaurar: { tipo: 'booleano', inicial: false }, confirmaCriar: { tipo: 'booleano', inicial: false }, aba: { tipo: 'texto', inicial: 'editor' }, de: { tipo: 'texto', inicial: '' }, para: { tipo: 'texto', inicial: '' }, novoComentario: { tipo: 'texto', inicial: '' }, respondendo: { tipo: 'texto', inicial: '' },
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
      botao('Releases', [def('painel', 'estado.painel == "releases" ? "" : "releases"'), exe('releases', {}, undefined, aviso('erro', 'erro'))]),
      botao('Diagramas', [def('painel', 'estado.painel == "diagramas" ? "" : "diagramas"'), def('tipoDiagrama', '"fluxo"'), exe('diagrama', { tipo: 'fluxo' }, undefined, aviso('erro', 'erro'))]),
      botao('Publicar', [exe('publicar', {}, [...aviso('sucesso', '"Publicado: release " + resultado.release + ". O site já usa as versões salvas."')], aviso('erro', 'erro'))]),
      texto('{estado.no ? (igual(estado.no, estado.noSalvo) ? (estado.aberto.origem == "base" ? "padrão da plataforma" : "salvo (v" + estado.aberto.seq + ")") : "● alterações não salvas") : ""}'),
    ]),
    ...(['sucesso', 'erro', 'neutro'] as const).map((tom) => P('feedback/alerta', { se: `estado.aviso && estado.tipoAviso == ${q(tom)}`, props: { tom }, filhos: [texto('{estado.aviso}')] })),
    linha([texto('Prévia:'), botao('claro', [def('modoPrevia', '"claro"'), atualizaPrevia], { se: 'estado.modoPrevia != "claro"' }), botao('escuro', [def('modoPrevia', '"escuro"'), atualizaPrevia], { se: 'estado.modoPrevia != "escuro"' }), texto('({estado.modoPrevia})')], { se: 'estado.no', props: { gap: 8 } }),
    releasesVista(),
    linha([criar('pagina'), criar('tema'), criar('formulario')]), formCriar(),
    barraPendente(),
    seletorDeNos('pagina'),
    seletorDeNos('tema'),
    seletorDeNos('formulario'),
    diagramasVista(),
    linha([
      botao('Restaurar o padrão', [def('confirmaRestaurar', 'true')], { se: 'estado.no && estado.aberto.origem == "tenant" && !estado.confirmaRestaurar' }),
      texto('Voltar {estado.aberto.id} ao padrão da plataforma? O histórico fica; vale no site após Publicar.', { se: 'estado.confirmaRestaurar' }),
      botao('Sim, restaurar', [exe('restaurar', { kind: '{estado.aberto.kind}', id: '{estado.aberto.id}' }, [...aviso('sucesso', '"Restaurado o padrão de " + estado.aberto.id + ". Publique para o site mudar."'), exe('nos'), def('no', 'null'), def('noSalvo', 'null'), def('aberto', 'null'), def('passado', '[]'), def('futuro', '[]'), def('confirmaRestaurar', 'false')], aviso('erro', 'erro'))], { se: 'estado.confirmaRestaurar' }),
      botao('Cancelar', [def('confirmaRestaurar', 'false')], { se: 'estado.confirmaRestaurar' }),
    ], { se: 'estado.no && estado.aberto.origem == "tenant"', props: { gap: 8 } }),
    linha([botao('Editor', [def('aba', '"editor"')]), botao('Histórico e comentários', [def('aba', '"historico"')])], { se: 'estado.no && estado.aberto.origem != "novo"' }),
    editorDePaginas(),
    editorDeTema(),
    editorDeFormularios(),
    historicoVista(),
  ], { gap: 12 }),
})

export const NOS_DO_STUDIO = [...DADOS, PAGINA]
