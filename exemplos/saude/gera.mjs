// Gera exemplos/saude/nos.json e conta.sementes: o painel "Customer health" (template do Lovable) portado para o Polaris como MODELO.
//   node exemplos/saude/gera.mjs
//   pnpm local --site exemplos/maison --modelo exemplos/saude   (guarda este modelo no banco; aplique pelo Studio > Modelos > Aplicar e publicar)
// Nada aqui é código de página: tema, textos por idioma (idiomas.mjs), dados da API de contas e uma página de blocos. O enxame de bolhas, as linhas de tendência e a cascata do detalhe são composições das primitivas
// `grafico/*` com as funções `enxame`, `escala`, `mediana`, `raiz`, `compacto` e `dataCurta`.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geraContas } from './dados.mjs'
import { IDIOMAS, MENSAGENS, PADRAO } from './idiomas.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))

// ---- cores: o template as declara em oklch; o tema guarda hex (convertido aqui) ------------------------------------------------------------------------
const lin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const hex = (L, C, h) => {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, lin(v))) * 255).toString(16).padStart(2, '0')).join('')}`
}
const ESCURO = { fundo: hex(0.16, 0.012, 62), superficie: hex(0.19, 0.013, 62), superficieAlt: hex(0.22, 0.014, 62), borda: hex(0.3, 0.012, 65), texto: hex(0.95, 0.012, 85), textoSuave: hex(0.65, 0.012, 75), meio: hex(0.78, 0.012, 80), risco: hex(0.68, 0.185, 34), neutro: hex(0.8, 0.02, 80) }
const CLARO = { fundo: hex(0.965, 0.008, 85), superficie: hex(0.94, 0.01, 85), superficieAlt: hex(0.92, 0.01, 85), borda: hex(0.83, 0.01, 80), texto: hex(0.21, 0.015, 62), textoSuave: hex(0.5, 0.012, 70), meio: hex(0.35, 0.014, 65), risco: hex(0.55, 0.17, 35), neutro: hex(0.45, 0.018, 58) }
const cores = (p) => ({ fundo: p.fundo, superficie: p.superficie, superficieAlt: p.superficieAlt, borda: p.borda, texto: p.texto, textoSuave: p.textoSuave, primaria: p.texto, primariaHover: p.meio, primariaClara: p.superficieAlt, secundaria: p.texto, destaque: p.risco, sucesso: p.neutro, alerta: p.risco, erro: p.risco, textoSobrePrimaria: p.fundo })
const grafico = (p) => ({ risco: p.risco, neutro: p.neutro, destaque: p.risco, eixo: p.textoSuave, suave: p.textoSuave, texto: p.texto, escuro: p.textoSuave, claro: p.neutro })
const painel = (p) => ({ regua: p.texto, divisoria: p.borda, superficie: p.superficie })
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

const tema = {
  kind: 'tema', id: 'saude', versao: '1.0.0', estatuto: 'publicado',
  spec: {
    fontes: ['newsreader', 'work-sans', 'ibm-plex-mono'],
    seguirSistema: false, // escuro por padrão (o template); o claro é um modo (`data-modo="claro"`) que a página liga por estado persistente
    tokens: {
      cor: cores(ESCURO), grafico: grafico(ESCURO), painel: { ...painel(ESCURO), espessura: '1px', recuo: '1.25rem', recuoTabela: '2rem' },
      raio: { pequeno: 999, grande: 2 }, espacamento: { base: '0.5rem', borda: 1 },
      layout: { largura: '71rem', larguraEstreita: '71rem', larguraLarga: '71rem', recuo: '1.5rem', recuoEstreito: '1.5rem' },
      tipografia: {
        familia: "'Work Sans', system-ui, -apple-system, 'Segoe UI', sans-serif", familiaTitulo: "'Newsreader', 'Iowan Old Style', Georgia, serif", familiaMono: MONO, margemParagrafo: 0, margemSobretitulo: 0, pesoTitulo: 400, tamanhoBase: '13px', alturaTitulo: 1.15, espacamentoTitulo: '-0.02em',
        escala: {
          pagina: { tamanho: '2.25rem', peso: 400, altura: 1.05, espacamento: '-0.02em' },
          secao: { tamanho: '1.25rem', peso: 400, altura: 1.4, espacamento: '-0.025em' },
          segmento: { tamanho: '1.125rem', peso: 400, altura: 1.3, espacamento: '-0.01em' },
          detalhe: { tamanho: '1.375rem', peso: 400, altura: 1.2, espacamento: '-0.01em' },
          indicador: { familia: MONO, tamanho: '2.75rem', peso: 400, altura: 1, espacamento: '-0.025em' },
          pontuacao: { familia: MONO, tamanho: '2.25rem', peso: 400, altura: 1, espacamento: '-0.02em' },
          olho: { tamanho: '0.625rem', peso: 400, altura: 1.5, espacamento: '0.18em' },
          meta: { familia: MONO, caixa: 'uppercase', tamanho: '0.6875rem', peso: 400, altura: 1.5, espacamento: '0.2em' },
          delta: { familia: MONO, tamanho: '0.6875rem', peso: 400, altura: 1.5, espacamento: '0' },
          dado: { familia: MONO, tamanho: '0.8125rem', peso: 400, altura: 1.5, espacamento: '0' },
          nota: { tamanho: '0.6875rem', peso: 400, altura: 1.5, espacamento: '0' },
          guia: { tamanho: '0.8125rem', peso: 400, altura: 1.55, espacamento: '0' },
        },
      },
      botao: {
        // os botões "pílula" do cabeçalho (mono, caixa alta) e as abas de texto (variante fantasma: corpo, sem recuo, cinza até serem a escolhida)
        controleFamilia: MONO, controleTamanho: '0.6875rem', controlePeso: 400, controleEspacamento: '0.2em', controleCaixa: 'uppercase', controleRecuoX: '0.8rem', controleRecuoY: '0.4rem',
        fantasmaFamilia: "'Work Sans', system-ui, sans-serif", fantasmaTamanho: '0.8125rem', fantasmaPeso: 400, fantasmaEspacamento: '-0.02em', fantasmaCaixa: 'none', fantasmaRecuoX: 0, fantasmaRecuoY: 0,
        fantasmaCor: 'var(--cor-texto-suave)', fantasmaCorAtiva: 'var(--cor-texto)', fantasmaFundoHover: 'transparent',
      },
      movimento: { rapido: '200ms', painel: '300ms', painelCurva: 'cubic-bezier(0.22, 1, 0.36, 1)' }, // a gaveta desliza e o véu esmaece em 300 ms, como no template
    },
    modos: { claro: { cor: cores(CLARO), grafico: grafico(CLARO), painel: painel(CLARO) } },
  },
}

// ---- textos: só chaves nas páginas; os idiomas vivem em idiomas.mjs ----------------------------------------------------------------------------------------
const tx = (k, params) => `t("${k}"${params ? `, objeto([${Object.entries(params).map(([n, e]) => `["${n}", ${e}]`).join(', ')}])` : ''})`
const T = (k, params) => `{${tx(k, params)}}`
const b = (bloco, props, filhos, extra = {}) => ({ bloco, ...(props ? { props } : {}), ...(filhos ? { slots: { filhos } } : {}), ...extra })
const txt = (texto, escala, extra = {}, tom) => b('texto/paragrafo', { texto, escala, ...(tom ? { tom } : {}) }, undefined, extra)
const pq = (texto, tom, extra = {}) => b('texto/pequeno', { texto, ...(tom ? { tom } : {}) }, undefined, extra)
const olho = (texto, extra = {}) => b('texto/sobretitulo', { texto, escala: 'olho' }, undefined, extra)
const definir = (estado, valor) => ({ acao: 'definir', estado, valor })

// ---- dados: as contas vêm da API (serviço `loja`, entidade `conta`); a listagem tem no máximo 100 por página, então são duas ------------------------------------------------
const dados = (id, pagina) => ({ kind: 'dados', id, versao: '1.0.0', estatuto: 'publicado', spec: { fonte: { tipo: 'servico', servico: 'loja', operacao: 'listarConta' }, parametros: { pagina: { tipo: 'inteiro' }, limite: { tipo: 'inteiro' } }, carregar: 'auto', cache: { ttlSegundos: 30 } } })
const DADOS = { c1: { dados: 'saude.contas1', args: { pagina: 1, limite: 100 } }, c2: { dados: 'saude.contas2', args: { pagina: 2, limite: 100 } } }
const CONTAS = 'concat(c1, c2)'

// ---- as expressões do painel (tudo derivado dos dados; nada digitado) -----------------------------------------------------------------------------------------------
const ATIVAS = `filtra(${CONTAS}, c => estado.filtro == "todos" || c.segmento == estado.filtro)`
const ARR = (lista) => `soma(mapeia(${lista}, c => qnum(c.arr)))`
const EM_RISCO = `filtra(${CONTAS}, c => c.saude < 40)`, EM_RISCO_ANTES = `filtra(${CONTAS}, c => c.historico[8] < 40)`
const RENOVAM = `filtra(${CONTAS}, c => c.renovacao <= "2027-02-19")`
const SINAL = (n) => `(${n} < 0 ? "−" : "+")`
const dif = (expr) => `junta([${SINAL(expr)}, compacto(absoluto(${expr}), idioma)], "")`
const MEDIANA = (campo) => `mediana(mapeia(${CONTAS}, c => ${campo}))`
const X = (s) => `escala(${s}, 0, 100, -51, 1030)` // a escala do template: 10,8 px por ponto, 20 em x=165 e 100 em x=1030 (o gráfico tem a largura do conteúdo, 1088)
// o enxame: cada grupo (uma linha de bolhas) vira uma lista de círculos com x, y e r
const SEGMENTOS = '["enterprise", "mid-market", "smb"]'
const LINHAS_SEG = `filtra(${SEGMENTOS}, s => estado.filtro == "todos" || estado.filtro == s)`
const GRUPOS = `(estado.visao == "combinado" ? [objeto([["k", "todos"], ["itens", ${ATIVAS}]])] : mapeia(${LINHAS_SEG}, s => objeto([["k", s], ["itens", filtra(${CONTAS}, c => c.segmento == s)]])))`
const CY = (k) => `(estado.visao == "combinado" ? 110 : 70 + ${k} * 130)`
const ALTURA = '(estado.visao == "combinado" ? 238 : 100 + tamanho(GRUPOS_) * 130)'.replace('GRUPOS_', GRUPOS)
const ROTULOS_LINHAS = `(estado.visao == "combinado" ? [] : mapeia(${GRUPOS}, (g, k) => mescla(g, objeto([["i", k]]))))`
const COR = (s) => `junta(["color-mix(in oklab, var(--grafico-risco) ", texto(arredonda(maximo(0, minimo(100, escala(${s}, 40, 80, 100, 0))))), "%, var(--grafico-neutro))"], "")`
const BOLHAS = `achata(mapeia(${GRUPOS}, (g, k) => mapeia(enxame(mapeia(g.itens, c => objeto([["slug", c.slug], ["nome", c.nome], ["saude", c.saude], ["arr", qnum(c.arr)], ["x", ${X('c.saude')}], ["r", escala(raiz(qnum(c.arr)), 100, 950, 2.5, 15)], ["cor", ${COR('c.saude')}]])), 1.5), p => mescla(p, objeto([["y", ${CY('k')} + p.y]])))))`
const SEGROT = `objeto([["enterprise", ${tx('seg.enterprise')}], ["mid-market", ${tx('seg.mid-market')}], ["smb", ${tx('seg.smb')}]])`
// a lista de atenção: as 8 contas com a maior queda; cada uma leva os pontos da sua linha de tendência (x a cada 6, y escalado entre o mínimo e o máximo da própria série)
const ATENCAO = `mapeia(mapeia(fatia(ordena(${CONTAS}, c => c.queda - qnum(c.arr) / 1000000000), 0, 8), c => mescla(c, objeto([["lo", primeiro(ordena(c.historico, v => v))], ["hi", ultimo(ordena(c.historico, v => v))]]))), c => mescla(c, objeto([["pts", mapeia(c.historico, (v, i) => [i * 6, escala(v, c.lo, c.hi, 22, 2)])]])))`
const NEG = (v) => `(${v} < 0 ? junta(["−", texto(absoluto(${v}))], "") : (${v} > 0 ? junta(["+", texto(${v})], "") : "0"))`

// ---- peças da página -----------------------------------------------------------------------------------------------------------------------------------------------------
const botaoModo = b('nav/botao', { texto: '{estado.modo == "escuro" ? ' + tx('modo.claro') + ' : ' + tx('modo.escuro') + '}', variante: 'primario', icone: '{estado.modo == "escuro" ? "sol" : "lua"}', rotulo: '{estado.modo == "escuro" ? ' + tx('modo.paraClaro') + ' : ' + tx('modo.paraEscuro') + '}' }, undefined, { eventos: { aoClicar: [definir('modo', 'estado.modo == "escuro" ? "claro" : "escuro"')] } })
const cabecalho = b('layout/linha', { gap: 10, alinha: 'centro', quebra: true }, [
  b('layout/linha', { gap: 20, alinha: 'centro', quebra: true }, [
    b('texto/titulo', { texto: T('titulo'), nivel: 1, escala: 'pagina' }),
    txt(T('meta', { n: `tamanho(${CONTAS})`, arr: `compacto(${ARR(CONTAS)}, idioma)` }), 'meta', {}, 'suave'),
  ]),
  b('layout/pilha', { cresce: true }),
  b('nav/botao', { texto: T('guia'), variante: 'secundario' }, undefined, { eventos: { aoClicar: [definir('guia', 'true')] } }),
  botaoModo,
])
const indicador = (rotulo, valor, delta, tomDelta) => b('layout/pilha', { gap: 8 }, [olho(rotulo), txt(valor, 'indicador'), txt(delta, 'delta', {}, tomDelta)])
const indicadores = b('layout/grade', { colunas: 4, marca: 'indicadores' }, [
  indicador(T('kpi.risco'), `{junta(["$", compacto(${ARR(EM_RISCO)}, idioma)], "")}`, T('kpi.vs', { d: dif(`${ARR(EM_RISCO)} - ${ARR(EM_RISCO_ANTES)}`) }), 'risco'),
  indicador(T('kpi.contasRisco'), `{tamanho(${EM_RISCO})}`, T('kpi.vs', { d: dif(`tamanho(${EM_RISCO}) - tamanho(${EM_RISCO_ANTES})`) }), 'risco'),
  indicador(T('kpi.mediana'), `{${MEDIANA('c.saude')}}`, T('kpi.vs', { d: dif(`${MEDIANA('c.saude')} - ${MEDIANA('c.historico[8]')}`) })),
  indicador(T('kpi.renovacoes'), `{junta(["$", compacto(${ARR(RENOVAM)}, idioma)], "")}`, T('kpi.contas', { n: `tamanho(${RENOVAM})` })),
])
const aba = (rotulo, estado, valor) => b('nav/botao', { texto: rotulo, variante: 'fantasma', atual: `{estado.${estado} == "${valor}"}` }, undefined, { eventos: { aoClicar: [definir(estado, `"${valor}"`)] } })
const controles = b('layout/linha', { gap: 40, alinha: 'centro', quebra: true }, [
  b('layout/linha', { gap: 10, alinha: 'centro', papel: 'group', rotulo: 'visão' }, [aba(T('visao.combinado'), 'visao', 'combinado'), txt('·', 'nota', {}, 'suave'), aba(T('visao.segmento'), 'visao', 'segmento')]),
  b('layout/linha', { gap: 24, alinha: 'centro', papel: 'group', rotulo: 'segmento' }, ['todos', 'enterprise', 'mid-market', 'smb'].map((f) => aba(T(`filtro.${f}`), 'filtro', f))),
])
const circulo = b('grafico/circulo', { cx: '{p.x}', cy: '{p.y}', r: '{p.r}', cor: '{p.cor}', rotulo: T('grafico.conta', { nome: 'p.nome', saude: 'p.saude', arr: 'compacto(p.arr, idioma)' }), selecionado: '{estado.detalhe && estado.sel == p.slug}' }, undefined,
  { repetir: { cada: BOLHAS, como: 'p', chave: 'p.slug' }, eventos: { aoClicar: [definir('sel', 'p.slug'), definir('detalhe', 'true')] } })
const grafico_ = b('layout/pilha', { marca: 'grafico-painel' }, [
  b('grafico/svg', { largura: 1088, altura: `{${ALTURA}}`, rotulo: T('grafico.rotulo') }, [
    b('grafico/reta', { x1: `{${X('40')}}`, y1: 30, x2: `{${X('40')}}`, y2: `{${ALTURA} - 40}`, tom: 'eixo' }),
    b('grafico/rotulo', { x: `{${X('40')} + 6}`, y: 20, texto: T('grafico.limite'), tamanho: 10, caixa: 'maiuscula', espacamento: 0.16, tom: 'suave', fonte: 'corpo' }),
    circulo,
    // rótulos das linhas (só por segmento): o nome em serifa e "contas · ARR" em mono
    b('grafico/rotulo', { x: 141, y: '{70 + g.i * 130 - 2}', texto: '{' + SEGROT + '[g.k]}', ancora: 'fim', tamanho: 18, fonte: 'titulo', tom: 'texto' }, undefined, { repetir: { cada: ROTULOS_LINHAS, como: 'g', chave: 'g.k' } }),
    b('grafico/rotulo', { x: 141, y: '{70 + g.i * 130 + 18}', texto: `{junta([texto(tamanho(g.itens)), " · $", compacto(${ARR('g.itens')}, idioma)], "")}`, ancora: 'fim', tamanho: 10, fonte: 'mono', tom: 'suave' }, undefined, { repetir: { cada: ROTULOS_LINHAS, como: 'g', chave: 'g.k' } }),
    ...[20, 40, 60, 80, 100].map((v) => b('grafico/rotulo', { x: `{${X(String(v))}}`, y: `{${ALTURA} - 20}`, texto: String(v), ancora: 'centro', tamanho: 11, tom: 'suave', fonte: 'mono' })),
    b('grafico/rotulo', { x: 598, y: `{${ALTURA} - 2}`, texto: T('grafico.eixo'), ancora: 'centro', tamanho: 11, tom: 'suave', fonte: 'corpo' }),
  ]),
])
const cel = (filhos, extra = {}) => b('tabela/celula', extra, filhos)
const cab = (k) => b('tabela/celula', { texto: T(`col.${k}`), cabecalho: true })
const linhaTabela = b('tabela/linha', { clicavel: true }, [
  cel([b('layout/linha', { gap: 8, alinha: 'centro' }, [b('nav/botao', { texto: '{c.nome}', variante: 'fantasma' }, undefined, { eventos: { aoClicar: [definir('sel', 'c.slug'), definir('detalhe', 'true')] } }), b('texto/sobretitulo', { texto: `{maiusculas(${SEGROT}[c.segmento])}`, escala: 'olho', tom: 'suave' })])]),
  cel(undefined, { texto: '{junta(["$", compacto(qnum(c.arr), idioma)], "")}' }),
  cel(undefined, { texto: '{c.saude}' }),
  cel([b('grafico/svg', { largura: 72, altura: 24, rotulo: '' }, [b('grafico/caminho', { pontos: '{c.pts}', cor: '{c.saude < 40 ? "var(--grafico-risco)" : "var(--grafico-neutro)"}', espessura: 1.2 }), b('grafico/circulo', { cx: 72, cy: '{ultimo(c.pts)[1]}', r: 2, cor: '{c.saude < 40 ? "var(--grafico-risco)" : "var(--grafico-neutro)"}' })])]),
  cel(undefined, { texto: `{${NEG('c.queda')}}`, tom: '{c.queda < 0 ? "risco" : "suave"}' }),
  cel(undefined, { texto: '{c.autonomia ? ' + tx('autonomia.valor', { n: 'c.autonomia' }) + ' : "—"}' }),
  cel(undefined, { texto: '{c.assentos}%' }),
  cel(undefined, { texto: `{${NEG('c.semana')}}`, tom: '{c.semana < 0 ? "risco" : "suave"}' }),
  cel(undefined, { texto: '{' + tx('dias', { n: 'c.ultimoContato' }) + '}', tom: '{c.ultimoContato > 30 ? "risco" : "suave"}' }),
  cel(undefined, { texto: '{dataCurta(c.renovacao, idioma)}' }),
])
// a linha inteira abre o detalhe (e o nome continua sendo o botão que o teclado alcança)
const abreLinha = { eventos: { aoClicar: [definir('sel', 'c.slug'), definir('detalhe', 'true')] } }
const lista = b('layout/pilha', { marca: 'tabela-painel', gap: 12 }, [
  b('texto/titulo', { texto: T('lista.titulo'), nivel: 2, escala: 'secao' }),
  b('tabela/tabela', undefined, [
    b('tabela/cabecalho', undefined, [b('tabela/linha', undefined, ['conta', 'arr', 'saude', 'semanas', 'queda', 'autonomia', 'assentos', 'semana', 'contato', 'renovacao'].map(cab))]),
    b('tabela/corpo', undefined, [{ ...linhaTabela, ...abreLinha, repetir: { cada: ATENCAO, como: 'c', chave: 'c.slug' } }]),
  ]),
  txt(T('lista.nota'), 'nota', {}, 'suave'),
])

// o detalhe da conta (gaveta): trajetória de 13 semanas, composição do índice (cascata) e os números da conta
const HIST = 'ordena(s.historico, v => v)'
const LINHA_DET = b('grafico/svg', { largura: 340, altura: 96, rotulo: T('detalhe.trajetoria') }, [
  b('grafico/reta', { x1: 22, y1: `{escala(40, primeiro(${HIST}), ultimo(${HIST}), 86, 10)}`, x2: 340, y2: `{escala(40, primeiro(${HIST}), ultimo(${HIST}), 86, 10)}`, tom: 'eixo', tracejada: true }),
  b('grafico/caminho', { pontos: `{mapeia(s.historico, (v, i) => [22 + i * 26.5, escala(v, primeiro(${HIST}), ultimo(${HIST}), 86, 10)])}`, tom: '{s.saude < 40 ? "risco" : "neutro"}', espessura: 1.4 }),
  b('grafico/circulo', { cx: 340, cy: `{escala(s.saude, primeiro(${HIST}), ultimo(${HIST}), 86, 10)}`, r: 2.5, tom: '{s.saude < 40 ? "risco" : "neutro"}' }),
  b('grafico/rotulo', { x: 0, y: 14, texto: `{ultimo(${HIST})}`, tamanho: 9, tom: 'suave', fonte: 'mono' }),
  b('grafico/rotulo', { x: 0, y: 92, texto: `{primeiro(${HIST})}`, tamanho: 9, tom: 'suave', fonte: 'mono' }),
])
// as linhas da cascata: a base, as seis variações (cada uma começa onde a anterior terminou) e o índice final
const CASCATA = `dobra(s.composicao, [objeto([["k", "base"], ["v", 55], ["ini", 0], ["fim", 55]])], (acc, d) => concat(acc, [objeto([["k", d.k], ["v", d.v], ["ini", ultimo(acc).fim], ["fim", ultimo(acc).fim + d.v]])]))`
const LINHAS_CASC = `concat(${CASCATA}, [objeto([["k", "saude"], ["v", s.saude], ["ini", 0], ["fim", s.saude]])])`
const DRIVERS = `objeto([["base", ${tx('driver.base')}], ["uso", ${tx('driver.uso')}], ["adocao", ${tx('driver.adocao')}], ["suporte", ${tx('driver.suporte')}], ["campeao", ${tx('driver.campeao')}], ["recursos", ${tx('driver.recursos')}], ["comercial", ${tx('driver.comercial')}], ["saude", ${tx('driver.saude')}]])`
const CX = (v) => `escala(${v}, 0, 100, 150, 330)`
const cascata = b('grafico/svg', { largura: 360, altura: 180, rotulo: T('detalhe.composicao') }, [
  b('grafico/rotulo', { x: 140, y: '{r.n * 21 + 14}', texto: `{${DRIVERS}[r.k]}`, ancora: 'fim', tamanho: 10, tom: 'texto', fonte: 'corpo' }, undefined, { repetir: { cada: `mapeia(${LINHAS_CASC}, (r, n) => mescla(r, objeto([["n", n]])))`, como: 'r', chave: 'r.k' } }),
  b('grafico/retangulo', { x: `{${CX('minimo(r.ini, r.fim)')}}`, y: '{r.n * 21 + 5}', largura: `{absoluto(${CX('r.fim')} - ${CX('r.ini')})}`, altura: 12, tom: '{r.k == "base" || r.k == "saude" ? "escuro" : (r.v < 0 ? "risco" : "claro")}' }, undefined, { repetir: { cada: `mapeia(${LINHAS_CASC}, (r, n) => mescla(r, objeto([["n", n]])))`, como: 'r', chave: 'r.k' } }),
  b('grafico/rotulo', { x: 356, y: '{r.n * 21 + 14}', texto: `{r.k == "base" || r.k == "saude" ? texto(r.v) : ${NEG('r.v')}}`, ancora: 'fim', tamanho: 10, tom: 'texto', fonte: 'mono' }, undefined, { repetir: { cada: `mapeia(${LINHAS_CASC}, (r, n) => mescla(r, objeto([["n", n]])))`, como: 'r', chave: 'r.k' } }),
])
const metrica = (rotulo, valor, tom) => b('layout/pilha', { gap: 4 }, [olho(rotulo), txt(valor, 'dado', {}, tom)])
const fechar = (estado, valor) => b('nav/botao', { texto: '', icone: 'fechar', variante: 'fantasma', rotulo: T('detalhe.fechar') }, undefined, { eventos: { aoClicar: [definir(estado, valor)] } })
const detalhe = b('layout/gaveta', { rotulo: T('detalhe.rotulo'), largura: 30, aberta: '{estado.detalhe}' }, [
  b('layout/pilha', { gap: 16 }, [
    b('layout/linha', { gap: 12, alinha: 'inicio' }, [
      b('layout/pilha', { gap: 6, cresce: true }, [b('texto/titulo', { texto: '{s.nome}', nivel: 2, escala: 'detalhe' }), txt(`{maiusculas(${T('detalhe.meta', { seg: `${SEGROT}[s.segmento]`, resp: 's.responsavel', data: 'dataCurta(s.renovacao, idioma)' }).slice(1, -1)})}`, 'meta', {}, 'suave')]),
      txt('{s.saude}', 'pontuacao'),
      fechar('detalhe', 'false'),
    ]),
    olho(T('detalhe.trajetoria')), LINHA_DET,
    olho(T('detalhe.composicao')), cascata,
    b('layout/divisor'),
    b('layout/grade', { colunas: 3, gap: 16 }, [
      metrica(T('detalhe.arr'), '{junta(["$", compacto(qnum(s.arr), idioma)], "")}'), metrica(T('detalhe.assentos'), '{s.assentos}%'), metrica(T('detalhe.contato'), '{' + tx('dias', { n: 's.ultimoContato' }) + '}'),
      metrica(T('detalhe.queda'), `{${NEG('s.queda')}}`, '{s.queda < 0 ? "risco" : "suave"}'), metrica(T('detalhe.autonomia'), '{s.autonomia ? ' + tx('autonomia.valor', { n: 's.autonomia' }) + ' : "—"}'),
    ]),
    txt(T('lista.nota'), 'nota', {}, 'suave'),
  ]),
])
// `s` é a conta selecionada: a gaveta se repete sobre uma lista de 0 ou 1 conta (assim a busca não se repete em cada expressão e, sem seleção, nada aparece)
const gavetaDetalhe = { ...detalhe, eventos: { aoFechar: [definir('detalhe', 'false')] }, repetir: { cada: `filtra(${CONTAS}, c => c.slug == estado.sel)`, como: 's', chave: 's.slug' } }
const passo = (n) => b('layout/pilha', { gap: 6 }, [olho(`0${n}`), b('texto/titulo', { texto: T(`guia.${n}.t`), nivel: 3, escala: 'detalhe' }), txt(T(`guia.${n}.p`), 'guia', {}, 'texto')])
const gavetaGuia = b('layout/gaveta', { rotulo: T('guia.titulo'), largura: 30, aberta: '{estado.guia}' }, [
  b('layout/pilha', { gap: 18 }, [
    b('layout/linha', { gap: 12, alinha: 'inicio' }, [b('layout/pilha', { gap: 6, cresce: true }, [b('texto/titulo', { texto: T('guia.titulo'), nivel: 2, escala: 'detalhe' }), olho(T('guia.sub'))]), fechar('guia', 'false')]),
    txt(T('guia.intro'), 'guia'),
    ...[1, 2, 3, 4].map(passo),
  ]),
], { eventos: { aoFechar: [definir('guia', 'false')] } })

const pagina = {
  kind: 'pagina', id: 'saude.home', versao: '1.0.0', estatuto: 'publicado',
  spec: {
    rota: '/', titulo: 'Customer health', traducoes: ['saude.textos'], dados: DADOS,
    estado: { visao: { tipo: 'texto', inicial: 'combinado' }, filtro: { tipo: 'texto', inicial: 'todos' }, sel: { tipo: 'texto', inicial: 'fenwick-legal' }, detalhe: { tipo: 'booleano', inicial: false }, guia: { tipo: 'booleano', inicial: false }, modo: { tipo: 'texto', inicial: 'escuro', persiste: true } },
    raiz: b('layout/pilha', { modo: '{estado.modo}', gap: 0, marca: 'painel-saude' }, [
      b('layout/contido', { largura: 'normal' }, [
        b('layout/pilha', { gap: 28 }, [b('layout/espacador', { tamanho: 8 }), cabecalho, indicadores, controles, grafico_, lista, b('layout/espacador', { tamanho: 64 })]),
      ]),
      gavetaDetalhe, gavetaGuia,
    ]),
  },
}
const tenant = (id, tenantId, nome) => ({ kind: 'tenant', id, tenantId, versao: '1.0.0', estatuto: 'publicado', spec: { alias: id, nome, segmento: 'varejo', modulos: ['loja'], tema: 'saude', paginas: ['saude.home'], idiomas: IDIOMAS, idiomaPadrao: PADRAO } })
const textos = { kind: 'traducao', id: 'saude.textos', versao: '1.0.0', estatuto: 'publicado', spec: { descricao: 'Textos do painel de saúde em pt-BR (padrão) e en (o texto do template)', padrao: PADRAO, mensagens: MENSAGENS } }

const nos = [tema, textos, dados('saude.contas1', 1), dados('saude.contas2', 2), pagina, tenant('loja-demo', '11111111-1111-1111-1111-111111111111', 'Loja Demo'), tenant('loja-outra', '22222222-2222-2222-2222-222222222222', 'Outra Loja')]
writeFileSync(join(aqui, 'nos.json'), `${JSON.stringify(nos, null, 2)}\n`)
writeFileSync(join(aqui, 'conta.sementes'), `${JSON.stringify(geraContas(), null, 2)}\n`)
console.log(`exemplos/saude/nos.json: ${nos.length} nós (tema, página, 2 dados, 2 tenants, catálogo pt-BR+en com ${Object.keys(MENSAGENS[PADRAO]).length} chaves) e conta.sementes (160 contas)`)
