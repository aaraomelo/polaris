import { rotasDe } from './servico-api'
import { sugere } from './sugere'
import type { Erro } from './mensagens'
import type { Contexto, Registry } from './registry'
import type { No } from './index'

// Um `formulario` é um CONTRATO com quem preenche e com o serviço que recebe. O JSON Schema garante a forma; aqui vai o que ele não diz:
// nomes únicos, seções/passos/regras apontando para campos que existem, regras compatíveis com o tipo do campo, máscaras coerentes com o tipo (um CPF precisa de 11 dígitos),
// expressão regular segura e o envio contra a operação REAL do serviço (nome, argumentos e obrigatórios). Erro de digitação aqui seria um formulário que só quebra em produção.

type Campo = {
  nome: string; tipo: string; validacao?: Record<string, unknown>; formato?: Record<string, unknown>; mascara?: { padrao: string | string[]; substituto?: string }
  opcoes?: unknown; campos?: Campo[]; padrao?: unknown
}
type Spec = {
  campos: Campo[]
  secoes?: Array<{ id: string; campos: string[] }>
  passos?: Array<{ id: string; campos?: string[]; secoes?: string[] }>
  validacoes?: Array<{ id: string; campos?: string[] }>
  envio?: { servico: string; operacao: string; args?: Record<string, unknown> }
  acoes?: Array<{ id: string; tipo: string }>
}

const erro = (caminho: string, regra: string, mensagem: string, dica?: string): Erro => ({ caminho, regra, mensagem, ...(dica ? { dica } : {}) })
const RESERVADOS = new Set(['__proto__', 'constructor', 'prototype', 'valores', 'valor', 'item'])
const NUMERICOS = new Set(['numero', 'inteiro', 'dinheiro', 'percentual'])
const TEXTUAIS = new Set(['texto', 'textoLongo', 'senha', 'email', 'telefone', 'url', 'cpf', 'cnpj', 'cep'])
const COM_MASCARA = new Set(['texto', 'textoLongo', 'email', 'telefone', 'url', 'numero', 'inteiro', 'data', 'hora', 'dataHora', 'cpf', 'cnpj', 'cep'])
/** quantos dígitos cada tipo brasileiro exige (a máscara precisa ter exatamente esses lugares; telefone aceita fixo ou celular) */
const DIGITOS: Record<string, number[]> = { cpf: [11], cnpj: [14], cep: [8], telefone: [10, 11] }
const SIMBOLOS = new Set(['0', '9', 'A', 'a', '*'])

/** analisa um padrão de máscara: lugares de dígito/letra e literais; `null` = padrão malformado (escape solto) */
export function analisaMascara(padrao: string): { lugares: number; digitos: number; obrigatorios: number } | null {
  let lugares = 0, digitos = 0, obrigatorios = 0
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i]!
    if (c === '\\') { if (i + 1 >= padrao.length) return null; i++; continue } // o próximo caractere é literal
    if (SIMBOLOS.has(c)) { lugares++; if (c === '0' || c === '9') digitos++; if (c === '0' || c === 'A' || c === 'a') obrigatorios++ }
  }
  return { lugares, digitos, obrigatorios }
}

/** expressão regular aceita: compila, é curta e NÃO tem repetição aninhada nem retrovisor (as formas clássicas de ReDoS) */
export function regexSegura(fonte: string): string | null {
  if (fonte.length > 200) return 'passa de 200 caracteres'
  try { new RegExp(`^(?:${fonte})$`, 'u') } catch (e) { return `não compila (${(e as Error).message.replace(/^Invalid regular expression: /, '').slice(0, 80)})` }
  if (/\\[1-9]|\\k</.test(fonte)) return 'usa retrovisor (\\1), que não é aceito'
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(fonte) || /\((?:[^()\\]|\\.)*\{\d*,\d*\}(?:[^()\\]|\\.)*\)[+*{]/.test(fonte)) return 'tem repetição aninhada (ex.: (a+)+), que pode travar o servidor'
  if (/\(\?[=!<]/.test(fonte)) return 'usa lookahead/lookbehind, que não é aceito'
  return null
}

export function validaFormulario(reg: Registry, no: No, ctx: Contexto = {}): Erro[] {
  if (no.kind !== 'formulario') return []
  const spec = no.spec as unknown as Spec, out: Erro[] = []
  const base = '/spec'

  const confereCampos = (campos: Campo[], caminho: string, profundidade: number) => {
    if (profundidade > 4) { out.push(erro(caminho, 'profundidade', 'grupos e listas aninhados demais (máximo 4 níveis)')); return }
    const nomes = new Set<string>()
    campos.forEach((c, i) => {
      const cam = `${caminho}/${i}`
      if (RESERVADOS.has(c.nome)) out.push(erro(`${cam}/nome`, 'nome', `'${c.nome}' é um nome reservado (as expressões o usam)`, 'escolha outro nome para o campo'))
      if (nomes.has(c.nome)) out.push(erro(`${cam}/nome`, 'nome', `já existe um campo '${c.nome}' neste formulário`, 'cada campo precisa de um nome único'))
      nomes.add(c.nome)
      confereCampo(c, cam, campos)
      if (c.campos) confereCampos(c.campos, `${cam}/campos`, profundidade + 1)
    })
  }

  const confereCampo = (c: Campo, cam: string, irmaos: Campo[]) => {
    const v = c.validacao ?? {}
    const so = (chaves: string[], tipos: Set<string>, rotulo: string) => { for (const k of chaves) if (v[k] !== undefined && !tipos.has(c.tipo)) out.push(erro(`${cam}/validacao/${k}`, 'validacao', `'${k}' só vale em campo ${rotulo} (este é '${c.tipo}')`)) }
    so(['minimo', 'maximo'], NUMERICOS, 'numérico (numero, inteiro, dinheiro, percentual)')
    so(['tamanhoMinimo', 'tamanhoMaximo'], TEXTUAIS, 'de texto')
    so(['dataMinima', 'dataMaxima'], new Set(['data', 'dataHora']), 'de data')
    so(['itensMinimo', 'itensMaximo'], new Set(['multiescolha', 'lista']), 'multiescolha ou lista')
    so(['extensoes', 'tamanhoMaximoBytes'], new Set(['arquivo']), 'arquivo')
    so(['padrao'], TEXTUAIS, 'de texto')
    if (typeof v.minimo === 'number' && typeof v.maximo === 'number' && v.minimo > v.maximo) out.push(erro(`${cam}/validacao`, 'validacao', `minimo (${v.minimo}) é maior que maximo (${v.maximo})`))
    if (typeof v.tamanhoMinimo === 'number' && typeof v.tamanhoMaximo === 'number' && v.tamanhoMinimo > v.tamanhoMaximo) out.push(erro(`${cam}/validacao`, 'validacao', `tamanhoMinimo (${v.tamanhoMinimo}) é maior que tamanhoMaximo (${v.tamanhoMaximo})`))
    if (typeof v.itensMinimo === 'number' && typeof v.itensMaximo === 'number' && v.itensMinimo > v.itensMaximo) out.push(erro(`${cam}/validacao`, 'validacao', `itensMinimo (${v.itensMinimo}) é maior que itensMaximo (${v.itensMaximo})`))
    for (const k of ['minimo', 'maximo'] as const) if (typeof v[k] === 'string' && !/^-?\d+(\.\d+)?$/.test(v[k] as string)) out.push(erro(`${cam}/validacao/${k}`, 'validacao', `'${String(v[k])}' não é um número decimal (use 12.50, com ponto)`))
    for (const k of ['dataMinima', 'dataMaxima'] as const) if (typeof v[k] === 'string' && !/^(\d{4}-\d{2}-\d{2}|hoje([+-]\d{1,4}[dma])?)$/.test(v[k] as string)) out.push(erro(`${cam}/validacao/${k}`, 'validacao', `'${String(v[k])}' não é data ISO (2026-01-31) nem 'hoje', 'hoje+30d', 'hoje-18a'`))
    if (typeof v.padrao === 'string') { const m = regexSegura(v.padrao); if (m) out.push(erro(`${cam}/validacao/padrao`, 'regex', `a expressão regular ${m}`)) }
    for (const k of ['igualA', 'diferenteDe'] as const) {
      const alvo = v[k]; if (typeof alvo !== 'string') continue
      if (alvo === c.nome) out.push(erro(`${cam}/validacao/${k}`, 'referencia', `o campo '${c.nome}' não pode ser ${k === 'igualA' ? 'igual' : 'diferente'} a si mesmo`))
      else if (!irmaos.some((x) => x.nome === alvo)) { const d = sugere(alvo, irmaos.map((x) => x.nome)); out.push(erro(`${cam}/validacao/${k}`, 'referencia', `'${alvo}' não é um campo deste formulário`, d ? `quis dizer '${d}'?` : undefined)) }
    }
    if (c.formato?.casasDecimais !== undefined && !NUMERICOS.has(c.tipo)) out.push(erro(`${cam}/formato/casasDecimais`, 'formato', `casasDecimais só vale em campo numérico (este é '${c.tipo}')`))
    if (c.formato?.moeda !== undefined && c.tipo !== 'dinheiro') out.push(erro(`${cam}/formato/moeda`, 'formato', `moeda só vale em campo 'dinheiro' (este é '${c.tipo}')`))
    if (c.formato?.formatoData !== undefined && c.tipo !== 'data' && c.tipo !== 'dataHora') out.push(erro(`${cam}/formato/formatoData`, 'formato', `formatoData só vale em campo de data (este é '${c.tipo}')`))
    // máscara: o tipo aceita, os padrões são válidos e têm os lugares que o tipo exige
    if (c.mascara) {
      const m = c.mascara
      if (!COM_MASCARA.has(c.tipo)) out.push(erro(`${cam}/mascara`, 'mascara', `campo '${c.tipo}' não tem máscara (ela vale em texto, e-mail, telefone, número, data, CPF, CNPJ e CEP)`))
      const padroes = Array.isArray(m.padrao) ? m.padrao : [m.padrao]
      if (new Set(padroes).size !== padroes.length) out.push(erro(`${cam}/mascara/padrao`, 'mascara', 'há padrões repetidos na lista de máscaras'))
      if (m.substituto && SIMBOLOS.has(m.substituto)) out.push(erro(`${cam}/mascara/substituto`, 'mascara', `'${m.substituto}' é um símbolo de máscara: use outro caractere para as posições vazias (ex.: _)`))
      padroes.forEach((p, n) => {
        const a = analisaMascara(p), caminho = Array.isArray(m.padrao) ? `${cam}/mascara/padrao/${n}` : `${cam}/mascara/padrao`
        if (!a) { out.push(erro(caminho, 'mascara', `a máscara '${p}' termina em '\\\\' sem dizer qual caractere escapar`)); return }
        if (a.lugares === 0) { out.push(erro(caminho, 'mascara', `a máscara '${p}' não tem nenhuma posição para digitar`, 'use 0 (dígito), 9 (dígito opcional), A (letra), a (letra ou dígito) ou * (qualquer um)')); return }
        const exige = DIGITOS[c.tipo]
        if (exige && !exige.includes(a.digitos)) out.push(erro(caminho, 'mascara', `a máscara '${p}' tem ${a.digitos} posição(ões) de dígito, mas ${c.tipo === 'telefone' ? 'um telefone com DDD' : c.tipo.toUpperCase()} tem ${exige.join(' ou ')}`))
        if (exige && a.lugares !== a.digitos) out.push(erro(caminho, 'mascara', `a máscara de ${c.tipo.toUpperCase()} só pode ter posições de dígito (0 ou 9)`))
        if ((c.tipo === 'numero' || c.tipo === 'inteiro') && a.lugares !== a.digitos) out.push(erro(caminho, 'mascara', `campo '${c.tipo}' só aceita posições de dígito na máscara (0 ou 9)`))
      })
    }
    // opções literais: valores únicos e do tipo do campo
    if (Array.isArray(c.opcoes)) {
      const vistos = new Set<unknown>()
      ;(c.opcoes as Array<{ valor: unknown }>).forEach((o, n) => {
        if (vistos.has(o.valor)) out.push(erro(`${cam}/opcoes/${n}/valor`, 'opcao', `o valor ${JSON.stringify(o.valor)} aparece em mais de uma opção`))
        vistos.add(o.valor)
        if (c.tipo === 'escolha' && c.padrao === undefined) return
      })
      if (c.padrao !== undefined && c.tipo === 'escolha' && !vistos.has(c.padrao)) out.push(erro(`${cam}/padrao`, 'opcao', `o valor padrão ${JSON.stringify(c.padrao)} não é uma das opções`))
    }
    if (c.padrao !== undefined && c.tipo === 'booleano' && typeof c.padrao !== 'boolean') out.push(erro(`${cam}/padrao`, 'padrao', 'o padrão de um campo booleano é true ou false'))
  }

  confereCampos(spec.campos, `${base}/campos`, 1)
  const topo = new Set(spec.campos.map((c) => c.nome))
  const nomesTopo = [...topo]
  const existe = (alvo: string, caminho: string, o: string) => { if (!topo.has(alvo)) { const d = sugere(alvo, nomesTopo); out.push(erro(caminho, 'referencia', `${o} '${alvo}' não é um campo deste formulário`, d ? `quis dizer '${d}'?` : undefined)) } }

  // seções
  const idsSecao = new Set<string>(), emSecao = new Map<string, string>()
  ;(spec.secoes ?? []).forEach((s, i) => {
    if (idsSecao.has(s.id)) out.push(erro(`${base}/secoes/${i}/id`, 'secao', `já existe uma seção '${s.id}'`)); idsSecao.add(s.id)
    s.campos.forEach((n, j) => { existe(n, `${base}/secoes/${i}/campos/${j}`, 'o campo'); if (topo.has(n)) { const antes = emSecao.get(n); if (antes) out.push(erro(`${base}/secoes/${i}/campos/${j}`, 'secao', `o campo '${n}' já está na seção '${antes}': um campo fica em uma seção só`)); else emSecao.set(n, s.id) } })
  })
  // passos (assistente): exclui seções; cada campo aparece em um passo só e nenhum campo fica de fora
  if (spec.passos) {
    if (spec.secoes) out.push(erro(`${base}/passos`, 'passos', "use `passos` OU `secoes`, não os dois (dentro de um passo, agrupe com `campos` ou liste as `secoes` do próprio passo)", 'mova as seções para dentro dos passos'))
    const idsPasso = new Set<string>(), emPasso = new Map<string, string>()
    spec.passos.forEach((p, i) => {
      if (idsPasso.has(p.id)) out.push(erro(`${base}/passos/${i}/id`, 'passo', `já existe um passo '${p.id}'`)); idsPasso.add(p.id)
      for (const [j, n] of (p.campos ?? []).entries()) { existe(n, `${base}/passos/${i}/campos/${j}`, 'o campo'); const antes = emPasso.get(n); if (topo.has(n) && antes) out.push(erro(`${base}/passos/${i}/campos/${j}`, 'passo', `o campo '${n}' já está no passo '${antes}'`)); else if (topo.has(n)) emPasso.set(n, p.id) }
    })
    for (const n of nomesTopo) if (!emPasso.has(n)) out.push(erro(`${base}/passos`, 'passo', `o campo '${n}' não está em nenhum passo e nunca apareceria`, `coloque '${n}' em \`campos\` de um passo`))
  }
  // regras entre campos
  const idsRegra = new Set<string>()
  ;(spec.validacoes ?? []).forEach((r, i) => {
    if (idsRegra.has(r.id)) out.push(erro(`${base}/validacoes/${i}/id`, 'regra', `já existe uma regra '${r.id}'`)); idsRegra.add(r.id)
    ;(r.campos ?? []).forEach((n, j) => existe(n, `${base}/validacoes/${i}/campos/${j}`, 'o campo'))
  })
  // ações
  const idsAcao = new Set<string>()
  ;(spec.acoes ?? []).forEach((a, i) => {
    if (idsAcao.has(a.id)) out.push(erro(`${base}/acoes/${i}/id`, 'acao', `já existe uma ação '${a.id}'`)); idsAcao.add(a.id)
    if (a.tipo === 'enviar' && !spec.envio) out.push(erro(`${base}/acoes/${i}`, 'acao', `a ação '${a.id}' envia o formulário, mas ele não declara \`envio\``, 'declare envio: { servico, operacao }'))
    if ((a.tipo === 'voltar' || a.tipo === 'avancar') && !spec.passos) out.push(erro(`${base}/acoes/${i}`, 'acao', `a ação '${a.id}' (${a.tipo}) só existe em formulário com \`passos\``))
  })
  // envio contra o contrato do serviço
  if (spec.envio) {
    const sv = reg.resolve('servico', spec.envio.servico, ctx)
    if (sv) {
      const rotas = rotasDe(sv.no), rota = rotas.find((r) => r.id === spec.envio!.operacao)
      if (!rota) { const d = sugere(spec.envio.operacao, rotas.map((r) => r.id)); out.push(erro(`${base}/envio/operacao`, 'operacao', `o serviço '${spec.envio.servico}' não tem a operação '${spec.envio.operacao}'`, d ? `quis dizer '${d}'?` : undefined)) }
      else {
        const entrada = rota.entrada as Record<string, { obrigatorio?: boolean }>, aceitos = [...Object.keys(entrada), ...rota.params]
        const envia = spec.envio.args ? Object.keys(spec.envio.args) : nomesTopo.filter((n) => aceitos.includes(n))
        for (const a of spec.envio.args ? Object.keys(spec.envio.args) : []) if (!aceitos.includes(a)) { const d = sugere(a, aceitos); out.push(erro(`${base}/envio/args/${a}`, 'argumento', `a operação '${rota.id}' não aceita o argumento '${a}'`, d ? `quis dizer '${d}'?` : undefined)) }
        for (const [n, def] of Object.entries(entrada)) if (def.obrigatorio && !envia.includes(n)) out.push(erro(`${base}/envio/args`, 'argumento', `a operação '${rota.id}' exige '${n}' e o formulário não o envia`, spec.envio.args ? `adicione args.${n}` : `crie um campo '${n}' ou declare args`))
        for (const p of rota.params) if (!envia.includes(p)) out.push(erro(`${base}/envio/args`, 'argumento', `a operação '${rota.id}' exige o parâmetro de caminho '${p}' e o formulário não o envia`))
      }
    }
  }
  return out
}
