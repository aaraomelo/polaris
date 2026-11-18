import { FUNCOES_PADRAO, ExprErro, avalia, deAstValidado, parseExpr, validaExpr, verdadeiro, type Ast, type Expr } from '../expr/index'
import { cepValido, cnpjValido, comparaDecimais, cpfValido, casasDe, dataHoraValida, emailValido, exibeData, horaValida, lerDecimal, normalizaTexto, paraDataIso, resolveDataRef, telefoneValido, urlValida, type FormatoData, type Normaliza } from './formato'
import { aplicaMascara, valorDaMascara, type OpcoesMascara } from './mascara'

// VALIDADOR do formulário: o mesmo código roda no navegador (feedback imediato) e no servidor (a validação que VALE). Recebe o que o visitante mandou (texto cru),
// devolve os valores NORMALIZADOS e TIPADOS (só os campos declarados: o resto é descartado) e os erros por campo, com a mensagem pronta no idioma pedido.

type Texto = string | Record<string, string>
export type Opcao = { valor: string | number | boolean; rotulo?: Texto; desabilitado?: boolean; se?: string | Ast; grupo?: string }
export type CampoSpec = {
  nome: string; tipo: string; rotulo?: Texto; obrigatorio?: boolean; obrigatorioSe?: string | Ast; padrao?: unknown; somenteLeitura?: boolean; desabilitado?: boolean; desabilitadoSe?: string | Ast
  se?: string | Ast; limpaSeOculto?: boolean; calculado?: string | Ast; normaliza?: Normaliza[]
  formato?: { casasDecimais?: number; moeda?: string; separadorDecimal?: ',' | '.'; formatoData?: FormatoData }
  mascara?: OpcoesMascara; mensagens?: Mensagens; opcoes?: Opcao[] | { dados: string }; campos?: CampoSpec[]
  validacao?: { minimo?: number | string; maximo?: number | string; tamanhoMinimo?: number; tamanhoMaximo?: number; padrao?: string; itensMinimo?: number; itensMaximo?: number; igualA?: string; diferenteDe?: string; dataMinima?: string; dataMaxima?: string; extensoes?: string[]; tamanhoMaximoBytes?: number; regras?: Array<{ id?: string; expr: string | Ast; mensagem: Texto }> }
}
export type Mensagens = Partial<Record<'obrigatorio' | 'minimo' | 'maximo' | 'tamanhoMinimo' | 'tamanhoMaximo' | 'padrao' | 'formato' | 'tipo' | 'igualA' | 'diferenteDe' | 'opcao' | 'itensMinimo' | 'itensMaximo' | 'dataMinima' | 'dataMaxima' | 'extensao' | 'tamanhoArquivo' | 'envio' | 'sucesso', Texto>>
export type FormularioSpec = {
  campos: CampoSpec[]; idioma?: string; mensagens?: Mensagens
  validacoes?: Array<{ id: string; regra: string | Ast; mensagem: Texto; campos?: string[]; quando?: 'alterar' | 'sair' | 'enviar' }>
}
export type ErroCampo = { campo: string; regra: string; mensagem: string }
/** o que a tela precisa saber de cada campo (por caminho: `nome`, `ends.0.rua`): aparece? está desabilitado? é obrigatório agora? */
export type EstadoCampo = { visivel: boolean; desabilitado: boolean; obrigatorio: boolean }
export type ResultadoForm = { ok: boolean; valores: Record<string, unknown>; erros: ErroCampo[]; porCampo: Record<string, ErroCampo[]>; estado: Record<string, EstadoCampo> }
export type OpcoesValida = {
  idioma?: string
  /** a data de HOJE (ISO) segundo o servidor; o relógio do visitante não decide */
  hoje?: string
  /** só estes campos (um passo do assistente); os demais não são validados nem exigidos */
  campos?: readonly string[]
  /** opções vindas de `dados` (campo → valores aceitos); sem a lista, a escolha não é conferida contra elas */
  opcoesDinamicas?: Record<string, ReadonlyArray<string | number | boolean>>
  /** regras entre campos de qual momento rodam (padrão: todas, como no envio) */
  quando?: 'alterar' | 'sair' | 'enviar'
}

// ---- mensagens ----------------------------------------------------------------------------------------------------------------------------------
const PADRAO_MSG: Record<string, Record<string, string>> = {
  'pt-BR': { obrigatorio: '{rotulo} é obrigatório.', tipo: '{rotulo} tem um valor inválido.', formato: '{rotulo} está em um formato inválido.', minimo: '{rotulo} deve ser no mínimo {min}.', maximo: '{rotulo} deve ser no máximo {max}.', tamanhoMinimo: '{rotulo} deve ter pelo menos {min} caracteres.', tamanhoMaximo: '{rotulo} aceita até {max} caracteres.', padrao: '{rotulo} está em um formato inválido.', igualA: '{rotulo} deve ser igual a {outro}.', diferenteDe: '{rotulo} deve ser diferente de {outro}.', opcao: 'Escolha uma opção válida em {rotulo}.', itensMinimo: 'Informe pelo menos {min} item(ns) em {rotulo}.', itensMaximo: '{rotulo} aceita até {max} item(ns).', dataMinima: '{rotulo} deve ser a partir de {min}.', dataMaxima: '{rotulo} deve ser até {max}.', extensao: '{rotulo}: extensão não permitida (aceitas: {max}).', tamanhoArquivo: '{rotulo} passa de {max} bytes.', regra: '{rotulo} não passou na validação.' },
  en: { obrigatorio: '{rotulo} is required.', tipo: '{rotulo} has an invalid value.', formato: '{rotulo} is not in a valid format.', minimo: '{rotulo} must be at least {min}.', maximo: '{rotulo} must be at most {max}.', tamanhoMinimo: '{rotulo} must have at least {min} characters.', tamanhoMaximo: '{rotulo} accepts up to {max} characters.', padrao: '{rotulo} is not in a valid format.', igualA: '{rotulo} must match {outro}.', diferenteDe: '{rotulo} must differ from {outro}.', opcao: 'Choose a valid option for {rotulo}.', itensMinimo: 'Add at least {min} item(s) to {rotulo}.', itensMaximo: '{rotulo} accepts up to {max} item(s).', dataMinima: '{rotulo} must be on or after {min}.', dataMaxima: '{rotulo} must be on or before {max}.', extensao: '{rotulo}: file type not allowed (accepted: {max}).', tamanhoArquivo: '{rotulo} is over {max} bytes.', regra: '{rotulo} did not pass validation.' },
}
const escolheTexto = (t: Texto | undefined, idioma: string, padrao?: string): string | undefined => {
  if (t === undefined) return undefined
  if (typeof t === 'string') return t
  const base = idioma.split('-')[0]!
  return t[idioma] ?? t[base] ?? (padrao ? t[padrao] : undefined) ?? t['pt-BR'] ?? Object.values(t)[0]
}
export const rotuloPadrao = (nome: string) => { const s = nome.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1) }
const preenche = (modelo: string, v: Record<string, unknown>) => modelo.replace(/\{(rotulo|valor|min|max|tamanho|outro)\}/g, (_m, k: string) => String(v[k] ?? ''))

// ---- expressões ---------------------------------------------------------------------------------------------------------------------------------
const cacheStr = new Map<string, Expr | null>(), cacheAst = new WeakMap<object, Expr | null>()
function exprDe(x: string | Ast): Expr | null {
  if (typeof x === 'string') { if (cacheStr.has(x)) return cacheStr.get(x)!; let e: Expr | null = null; try { e = parseExpr(x) } catch (err) { if (!(err instanceof ExprErro)) throw err } if (cacheStr.size > 2000) cacheStr.clear(); cacheStr.set(x, e); return e }
  if (cacheAst.has(x)) return cacheAst.get(x)!
  let e: Expr | null = null; try { e = deAstValidado(x) } catch { /* AST inválido: a validação da compilação já reportou */ }
  cacheAst.set(x, e); return e
}
const roda = (x: string | Ast, escopo: Record<string, unknown>): unknown => { const e = exprDe(x); return e ? avalia(e, escopo, FUNCOES_PADRAO) : undefined }

/** confere as expressões do formulário SEM executá-las: sintaxe, variáveis (só `valores`, `valor`) e funções. Devolve `caminho: problema`. */
export function confereExpressoes(spec: FormularioSpec): string[] {
  const out: string[] = []
  const ve = (x: string | Ast | undefined, caminho: string, escopo: readonly string[]) => {
    if (x === undefined) return
    const e = exprDe(x); if (!e) { out.push(`${caminho}: expressão inválida`); return }
    for (const p of validaExpr(e, escopo)) out.push(`${caminho}: ${p.mensagem}`)
  }
  const campos = (lista: CampoSpec[], base: string) => lista.forEach((c, i) => {
    const b = `${base}/${i}`
    ve(c.se, `${b}/se`, ['valores']); ve(c.obrigatorioSe, `${b}/obrigatorioSe`, ['valores']); ve(c.desabilitadoSe, `${b}/desabilitadoSe`, ['valores']); ve(c.calculado, `${b}/calculado`, ['valores'])
    ;(c.validacao?.regras ?? []).forEach((r, n) => ve(r.expr, `${b}/validacao/regras/${n}/expr`, ['valor', 'valores']))
    if (Array.isArray(c.opcoes)) c.opcoes.forEach((o, n) => ve(o.se, `${b}/opcoes/${n}/se`, ['valores']))
    if (c.campos) campos(c.campos, `${b}/campos`)
  })
  campos(spec.campos, '/spec/campos')
  ;(spec.validacoes ?? []).forEach((r, i) => ve(r.regra, `/spec/validacoes/${i}/regra`, ['valores']))
  return out
}

// ---- normalização e tipagem de UM valor -----------------------------------------------------------------------------------------------------------
const vazio = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
const TIPOS_TEXTO = new Set(['texto', 'textoLongo', 'senha', 'email', 'telefone', 'url', 'cpf', 'cnpj', 'cep'])
const NORM_PADRAO: Record<string, Normaliza[]> = { email: ['aparar', 'minusculas'], cpf: ['apenasDigitos'], cnpj: ['apenasDigitos'], cep: ['apenasDigitos'], telefone: ['apenasDigitos'], texto: ['aparar'], textoLongo: [], url: ['aparar'] }

/** do valor cru para o valor guardado. `null` em `erro` = ok. */
export function normalizaCampo(c: CampoSpec, bruto: unknown): { valor: unknown; erro: 'tipo' | 'formato' | null } {
  if (vazio(bruto)) return { valor: c.tipo === 'booleano' ? false : c.tipo === 'multiescolha' || c.tipo === 'lista' ? [] : undefined, erro: null }
  switch (c.tipo) {
    case 'booleano': return { valor: bruto === true || bruto === 'true' || bruto === 'on' || bruto === '1' || bruto === 1, erro: typeof bruto === 'boolean' || ['true', 'false', 'on', 'off', '1', '0', 1, 0].includes(bruto as never) ? null : 'tipo' }
    case 'numero': case 'percentual': case 'dinheiro': case 'inteiro': {
      const casas = c.tipo === 'dinheiro' ? 2 : undefined
      const dec = typeof bruto === 'number' ? (Number.isFinite(bruto) ? lerDecimal(String(bruto), '.') : null) : typeof bruto === 'string' ? lerDecimal(bruto, c.formato?.separadorDecimal ?? (/^-?\d+\.\d+$|^-?\d+$/.test(bruto.trim()) ? '.' : ',')) : null
      if (dec === null) return { valor: bruto, erro: 'tipo' }
      if (c.tipo === 'inteiro' && casasDe(dec) > 0) return { valor: bruto, erro: 'formato' }
      const limite = c.formato?.casasDecimais ?? casas; if (limite !== undefined && casasDe(dec) > limite) return { valor: dec, erro: 'formato' }
      // `numero`/`inteiro` viram número JS; dinheiro e percentual ficam decimal EXATO em texto
      return { valor: c.tipo === 'numero' || c.tipo === 'inteiro' ? Number(dec) : dec, erro: null }
    }
    case 'data': { if (typeof bruto !== 'string') return { valor: bruto, erro: 'tipo' }; const iso = paraDataIso(bruto, c.formato?.formatoData); return iso ? { valor: iso, erro: null } : { valor: bruto, erro: 'formato' } }
    case 'hora': return typeof bruto === 'string' ? { valor: bruto.trim(), erro: horaValida(bruto.trim()) ? null : 'formato' } : { valor: bruto, erro: 'tipo' }
    case 'dataHora': return typeof bruto === 'string' ? { valor: bruto.trim(), erro: dataHoraValida(bruto.trim()) ? null : 'formato' } : { valor: bruto, erro: 'tipo' }
    case 'escolha': return { valor: bruto, erro: ['string', 'number', 'boolean'].includes(typeof bruto) ? null : 'tipo' }
    case 'multiescolha': return Array.isArray(bruto) ? { valor: bruto, erro: bruto.every((x) => ['string', 'number', 'boolean'].includes(typeof x)) ? null : 'tipo' } : { valor: bruto, erro: 'tipo' }
    case 'arquivo': return { valor: bruto, erro: typeof bruto === 'object' && bruto !== null && typeof (bruto as { nome?: unknown }).nome === 'string' ? null : 'tipo' }
    case 'oculto': return { valor: bruto, erro: null }
    case 'grupo': return { valor: bruto, erro: typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto) ? null : 'tipo' }
    case 'lista': return { valor: bruto, erro: Array.isArray(bruto) ? null : 'tipo' }
    default: {
      if (!TIPOS_TEXTO.has(c.tipo)) return { valor: bruto, erro: 'tipo' }
      if (typeof bruto !== 'string' && typeof bruto !== 'number') return { valor: bruto, erro: 'tipo' }
      let s = String(bruto)
      if (c.mascara) s = valorDaMascara(s, c.mascara)
      s = normalizaTexto(s, c.normaliza ?? NORM_PADRAO[c.tipo] ?? [])
      return { valor: s, erro: null }
    }
  }
}

function formatoValido(c: CampoSpec, v: string): boolean {
  switch (c.tipo) { case 'email': return emailValido(v); case 'cpf': return cpfValido(v); case 'cnpj': return cnpjValido(v); case 'cep': return cepValido(v); case 'telefone': return telefoneValido(v); case 'url': return urlValida(v); default: return true }
}
const igualValor = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))

// ---- o validador --------------------------------------------------------------------------------------------------------------------------------
export function validaValores(spec: FormularioSpec, brutos: Record<string, unknown>, opc: OpcoesValida = {}): ResultadoForm {
  const idioma = opc.idioma ?? spec.idioma ?? 'pt-BR', hoje = opc.hoje ?? new Date().toISOString().slice(0, 10)
  const erros: ErroCampo[] = [], estado: Record<string, EstadoCampo> = {}
  const msg = (c: CampoSpec, regra: string, p: Record<string, unknown>, textoRegra?: Texto): string => {
    const rotulo = escolheTexto(c.rotulo, idioma, spec.idioma) ?? rotuloPadrao(c.nome)
    const modelo = escolheTexto(textoRegra ?? c.mensagens?.[regra as keyof Mensagens] ?? spec.mensagens?.[regra as keyof Mensagens], idioma, spec.idioma) ?? (PADRAO_MSG[idioma] ?? PADRAO_MSG[idioma.split('-')[0]!] ?? PADRAO_MSG['pt-BR']!)[regra] ?? PADRAO_MSG['pt-BR']![regra]!
    return preenche(modelo, { rotulo, ...p })
  }
  const falha = (caminho: string, c: CampoSpec, regra: string, p: Record<string, unknown> = {}, textoRegra?: Texto) => erros.push({ campo: caminho, regra, mensagem: msg(c, regra, { valor: typeof p.valor === 'object' ? '' : p.valor, ...p }, textoRegra) })

  const processa = (campos: CampoSpec[], brutosNivel: Record<string, unknown>, prefixo: string, todos: Record<string, unknown>, restringe?: readonly string[]): Record<string, unknown> => {
    // 1ª passada: normaliza (tipa) tudo, para as expressões verem os valores já limpos
    const norm: Record<string, { valor: unknown; erro: 'tipo' | 'formato' | null }> = {}, finais: Record<string, unknown> = {}
    for (const c of campos) {
      if (restringe && !restringe.includes(c.nome)) continue
      const apagado = c.somenteLeitura || c.desabilitado || c.calculado !== undefined // o visitante NÃO manda nestes: o valor vem do `padrao` ou do cálculo
      norm[c.nome] = apagado ? { valor: c.padrao, erro: null } : normalizaCampo(c, Object.prototype.hasOwnProperty.call(brutosNivel, c.nome) ? brutosNivel[c.nome] : c.padrao)
      finais[c.nome] = norm[c.nome]!.valor
    }
    const escopo = { valores: { ...todos, ...finais } }
    for (const c of campos) { if (c.calculado !== undefined && norm[c.nome]) { finais[c.nome] = roda(c.calculado, escopo); norm[c.nome]!.valor = finais[c.nome] } }
    const escopo2 = { valores: { ...todos, ...finais } }
    const saida: Record<string, unknown> = {}
    for (const c of campos) {
      const n = norm[c.nome]; if (!n) continue
      const caminho = prefixo + c.nome
      const visivel = c.se === undefined ? true : (() => { const r = roda(c.se!, escopo2); return r === undefined ? true : verdadeiro(r) })()
      const v = c.validacao ?? {}
      const obrigatorio = c.obrigatorio === true || (c.obrigatorioSe !== undefined && verdadeiro(roda(c.obrigatorioSe, escopo2)))
      const desabilitadoAgora = c.desabilitado === true || c.somenteLeitura === true || c.calculado !== undefined || (c.desabilitadoSe !== undefined && verdadeiro(roda(c.desabilitadoSe, escopo2)))
      estado[caminho] = { visivel, desabilitado: desabilitadoAgora, obrigatorio }
      if (!visivel) { if (c.limpaSeOculto === false) saida[c.nome] = n.valor; continue }
      if (c.desabilitadoSe !== undefined && verdadeiro(roda(c.desabilitadoSe, escopo2))) { saida[c.nome] = c.padrao; continue }
      let valor = n.valor; saida[c.nome] = valor
      const ehVazio = vazio(valor) || (c.tipo === 'booleano' && valor === false && c.obrigatorio === true)
      if (ehVazio && c.tipo !== 'grupo') {
        if (obrigatorio && !c.somenteLeitura && c.calculado === undefined) falha(caminho, c, 'obrigatorio')
        else if ((c.tipo === 'lista' || c.tipo === 'multiescolha') && (v.itensMinimo ?? 0) > 0) falha(caminho, c, 'itensMinimo', { min: v.itensMinimo }) // lista vazia que exige itens
        continue
      }
      if (n.erro) { falha(caminho, c, n.erro, { valor: typeof valor === 'object' ? '' : valor }); continue }
      const p = (extra: Record<string, unknown> = {}) => ({ valor: typeof valor === 'object' ? '' : valor, ...extra })
      // texto
      if (typeof valor === 'string' && TIPOS_TEXTO.has(c.tipo)) {
        if (c.mascara && !temMascaraCompleta(c.mascara, valor)) { falha(caminho, c, 'formato', p()); continue } // máscara incompleta: é o erro principal
        if (!formatoValido(c, valor)) { falha(caminho, c, 'formato', p()); continue }
        const t = [...valor].length
        if (v.tamanhoMinimo !== undefined && t < v.tamanhoMinimo) falha(caminho, c, 'tamanhoMinimo', p({ min: v.tamanhoMinimo, tamanho: t }))
        if (v.tamanhoMaximo !== undefined && t > v.tamanhoMaximo) falha(caminho, c, 'tamanhoMaximo', p({ max: v.tamanhoMaximo, tamanho: t }))
        if (v.padrao !== undefined && valor.length <= 10_000) { let ok = false; try { ok = new RegExp(`^(?:${v.padrao})$`, 'u').test(valor) } catch { ok = false } if (!ok) falha(caminho, c, 'padrao', p()) }
      }
      // números (exatos)
      if (['numero', 'inteiro', 'dinheiro', 'percentual'].includes(c.tipo)) {
        const dec = String(valor)
        if (v.minimo !== undefined) { const r = comparaDecimais(dec, String(v.minimo)); if (r !== null && r < 0) falha(caminho, c, 'minimo', p({ min: v.minimo })) }
        if (v.maximo !== undefined) { const r = comparaDecimais(dec, String(v.maximo)); if (r !== null && r > 0) falha(caminho, c, 'maximo', p({ max: v.maximo })) }
      }
      // datas
      if (c.tipo === 'data' && typeof valor === 'string') {
        const f = c.formato?.formatoData
        if (v.dataMinima !== undefined) { const m = resolveDataRef(v.dataMinima, hoje); if (m && valor < m) falha(caminho, c, 'dataMinima', p({ min: exibeData(m, f) })) }
        if (v.dataMaxima !== undefined) { const m = resolveDataRef(v.dataMaxima, hoje); if (m && valor > m) falha(caminho, c, 'dataMaxima', p({ max: exibeData(m, f) })) }
      }
      // escolhas
      if (c.tipo === 'escolha' || c.tipo === 'multiescolha') {
        const validas = Array.isArray(c.opcoes) ? c.opcoes.filter((o) => !o.desabilitado && (o.se === undefined || verdadeiro(roda(o.se, escopo2)))).map((o) => o.valor) : opc.opcoesDinamicas?.[c.nome]
        const vals = c.tipo === 'escolha' ? [valor] : (valor as unknown[])
        if (validas) {
          const casados = vals.map((x) => validas.find((o) => o === x || String(o) === String(x) && typeof x === 'string'))
          if (casados.some((x) => x === undefined)) falha(caminho, c, 'opcao', p())
          else { valor = c.tipo === 'escolha' ? casados[0] : casados; saida[c.nome] = valor } // volta ao tipo da opção ("1" → 1)
        }
        if (c.tipo === 'multiescolha') {
          const n2 = (valor as unknown[]).length
          if (v.itensMinimo !== undefined && n2 < v.itensMinimo) falha(caminho, c, 'itensMinimo', p({ min: v.itensMinimo }))
          if (v.itensMaximo !== undefined && n2 > v.itensMaximo) falha(caminho, c, 'itensMaximo', p({ max: v.itensMaximo }))
        }
      }
      // arquivo
      if (c.tipo === 'arquivo') {
        const a = valor as { nome: string; tamanho?: number }
        if (v.extensoes && !v.extensoes.some((e) => a.nome.toLowerCase().endsWith(e))) falha(caminho, c, 'extensao', p({ max: v.extensoes.join(', ') }))
        if (v.tamanhoMaximoBytes !== undefined && typeof a.tamanho === 'number' && a.tamanho > v.tamanhoMaximoBytes) falha(caminho, c, 'tamanhoArquivo', p({ max: v.tamanhoMaximoBytes }))
      }
      // grupo e lista: cada item com os campos do próprio escopo
      if (c.tipo === 'grupo' && c.campos) saida[c.nome] = processa(c.campos, valor as Record<string, unknown>, `${caminho}.`, todos)
      if (c.tipo === 'lista' && c.campos) {
        const itens = valor as unknown[]
        if (v.itensMinimo !== undefined && itens.length < v.itensMinimo) falha(caminho, c, 'itensMinimo', p({ min: v.itensMinimo }))
        if (v.itensMaximo !== undefined && itens.length > v.itensMaximo) falha(caminho, c, 'itensMaximo', p({ max: v.itensMaximo }))
        saida[c.nome] = itens.slice(0, 1000).map((it, i) => processa(c.campos!, typeof it === 'object' && it !== null ? (it as Record<string, unknown>) : {}, `${caminho}.${i}.`, todos))
      }
      // entre campos do mesmo nível
      for (const [k, regra] of [['igualA', 'igualA'], ['diferenteDe', 'diferenteDe']] as const) {
        const alvo = v[k]; if (alvo === undefined) continue
        const outro = finais[alvo], campoOutro = campos.find((x) => x.nome === alvo)
        const iguais = igualValor(valor, outro)
        if (k === 'igualA' ? !iguais : iguais) falha(caminho, c, regra, p({ outro: escolheTexto(campoOutro?.rotulo, idioma, spec.idioma) ?? rotuloPadrao(alvo) }))
      }
      // regras do campo (expressão: verdadeira = válido; erro de avaliação = inválido, nunca passa em silêncio)
      for (const r of v.regras ?? []) { const res = roda(r.expr, { valor: valor, valores: escopo2.valores }); if (res === undefined || !verdadeiro(res)) falha(caminho, c, r.id ?? 'regra', p(), r.mensagem) }
    }
    return saida
  }

  const valores = processa(spec.campos, brutos ?? {}, '', {}, opc.campos)
  // regras entre campos (do formulário)
  const q = opc.quando ?? 'enviar'
  for (const r of spec.validacoes ?? []) {
    const quando = r.quando ?? 'enviar'
    if (q !== 'enviar' && quando !== q && !(q === 'alterar' && quando === 'sair')) continue
    if (opc.campos && r.campos && !r.campos.every((n) => opc.campos!.includes(n))) continue
    const res = roda(r.regra, { valores })
    if (res !== undefined && verdadeiro(res)) continue
    const texto = escolheTexto(r.mensagem, idioma, spec.idioma) ?? PADRAO_MSG['pt-BR']!.regra!
    for (const campo of r.campos?.length ? r.campos : ['_formulario']) erros.push({ campo, regra: r.id, mensagem: texto })
  }
  const porCampo: Record<string, ErroCampo[]> = {}
  for (const e of erros) (porCampo[e.campo] ??= []).push(e)
  return { ok: erros.length === 0, valores, erros, porCampo, estado }
}

/** a máscara está completa para o valor guardado? (com literais ou sem: a conferência refaz a máscara) */
function temMascaraCompleta(m: OpcoesMascara, valor: string): boolean {
  const padroes = typeof m.padrao === 'string' ? [m.padrao] : m.padrao
  return padroes.some((p) => aplicaTeste(p, valor, m))
}
function aplicaTeste(padrao: string, valor: string, m: OpcoesMascara): boolean { const r = aplicaMascara(valor, { ...m, padrao, mostraLiterais: true }); return r.completo && !r.estouro && (m.enviaComLiterais ? r.formatado === valor : r.bruto === valor) }

/** o texto no idioma pedido (com queda para o padrão do formulário, pt-BR e o primeiro disponível) */
export const textoI18n = escolheTexto
/** avalia uma expressão do formulário sobre um escopo (`valores`…); `undefined` se falhar */
export const avaliaExpressao = roda
