import { DocumentoErro, interpola, leCaminho, raizesDe, verdadeiro } from './interpola'
import { FONTE_PADRAO, FONTES } from './fontes'
import { type Bloco, type Celula, type DocumentoResolvido, type Estilo, type Rgb } from './modelo'

// Do nó `documento` (spec em português) + dados → documento RESOLVIDO. Tudo que é erro de autoria ou de dados quebra aqui (fail-closed): nunca sai papel com binding cru, dado faltando ou imagem de origem arbitrária.

type Obj = Record<string, any>
const MAX_BLOCOS = 5000, MAX_LINHAS_TOTAL = 20_000
const RESERVADOS = new Set(['pagina', 'paginas'])
const TIPOS_DADO: Record<string, (v: unknown) => boolean> = {
  texto: (v) => typeof v === 'string',
  numero: (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^[+-]?\d+(\.\d+)?$/.test(v)),
  dinheiro: (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^[+-]?\d{1,30}(\.\d{1,30})?$/.test(v)),
  data: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  dataHora: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v),
  booleano: (v) => typeof v === 'boolean',
  json: (v) => v !== undefined,
  lista: (v) => Array.isArray(v),
}

function hex(c: string | undefined): Rgb | undefined { return c ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb : undefined }
const estilo = (b: Obj): Estilo => ({ ...(b.tamanho !== undefined ? { tamanho: b.tamanho } : {}), ...(b.peso ? { peso: b.peso } : {}), ...(b.cor ? { cor: hex(b.cor)! } : {}), ...(b.alinhamento ? { alinhamento: b.alinhamento } : {}) })

/** Erros de AUTORIA (sem dados): bindings malformados, filtros desconhecidos, raiz que não é um dado declarado nem alias de `repetir`. */
export function validaDocumento(spec: Obj): string[] {
  const erros: string[] = []
  const decl = new Set(Object.keys(spec.dados ?? {}))
  const temDados = spec.dados !== undefined
  const tpl = (t: unknown, onde: string, escopo: Set<string>, extra: Set<string> = new Set()) => {
    if (t === undefined) return
    if (typeof t !== 'string') { erros.push(`${onde}: texto esperado`); return }
    try { for (const r of raizesDe(t)) if (temDados && !escopo.has(r) && !extra.has(r)) erros.push(`${onde}: "${r}" não é um dado declarado em spec.dados`) } catch (e) { erros.push(`${onde}: ${(e as Error).message}`) }
  }
  const cond = (c: unknown, onde: string, escopo: Set<string>) => {
    if (c === undefined) return
    try { const cam = String(c).replace(/^!/, ''); verdadeiro(String(c), {}); const r = cam.split('.')[0]!; if (temDados && !escopo.has(r)) erros.push(`${onde}: "${r}" não é um dado declarado`) } catch (e) { erros.push(`${onde}: ${(e as Error).message}`) }
  }
  const bloco = (b: Obj, onde: string, esc: Set<string>) => {
    let escopo = esc
    if (b.repetir) {
      const r = b.repetir; cond(r.cada, `${onde}.repetir.cada`, esc)
      if (decl.has(r.como) || RESERVADOS.has(r.como)) erros.push(`${onde}.repetir.como: "${r.como}" esconde um dado declarado`)
      escopo = new Set([...esc, r.como])
    }
    cond(b.se, `${onde}.se`, escopo)
    for (const k of ['texto', 'rotulo', 'valor', 'src', 'alt']) tpl(b[k], `${onde}.${k}`, escopo)
    if (b.tipo === 'imagem' && typeof b.src === 'string' && !/^data:image\/(png|jpeg);base64,/.test(b.src) && !/^\{[^}]*\}$/.test(b.src)) erros.push(`${onde}.src: só data URL png/jpeg (ou um binding que resulte nisso)`)
    if (b.tipo === 'tabela') {
      b.colunas?.forEach((c: Obj, i: number) => tpl(c.cabecalho, `${onde}.colunas[${i}]`, escopo))
      const cel = (c: unknown, o: string, e: Set<string>) => { if (typeof c === 'string') tpl(c, o, e); else if (c && typeof c === 'object') { tpl((c as Obj).principal, o, e); tpl((c as Obj).secundario, o, e) } }
      b.linhas?.forEach((l: unknown[], i: number) => l.forEach((c, j) => cel(c, `${onde}.linhas[${i}][${j}]`, escopo)))
      if (b.linhasDe) {
        const l = b.linhasDe; cond(l.cada, `${onde}.linhasDe.cada`, escopo)
        if (decl.has(l.como) || escopo.has(l.como) || RESERVADOS.has(l.como)) erros.push(`${onde}.linhasDe.como: "${l.como}" esconde outro nome`)
        l.celulas?.forEach((c: unknown, j: number) => cel(c, `${onde}.linhasDe.celulas[${j}]`, new Set([...escopo, l.como])))
        if (b.colunas && l.celulas && l.celulas.length > b.colunas.length) erros.push(`${onde}.linhasDe: mais células que colunas`)
      }
      b.linhas?.forEach((l: unknown[], i: number) => { if (b.colunas && l.length > b.colunas.length) erros.push(`${onde}.linhas[${i}]: mais células que colunas`) })
    }
    if (b.tipo === 'resumo') b.linhas?.forEach((l: Obj, i: number) => { tpl(l.rotulo, `${onde}.linhas[${i}].rotulo`, escopo); tpl(l.valor, `${onde}.linhas[${i}].valor`, escopo) })
    if (b.tipo === 'assinaturas') b.itens?.forEach((l: Obj, i: number) => tpl(l.rotulo, `${onde}.itens[${i}]`, escopo))
    if (b.tipo === 'campo') tpl(undefined, '', escopo)
    if (b.tipo === 'colunas') b.colunas?.forEach((c: Obj, i: number) => c.blocos?.forEach((x: Obj, j: number) => bloco(x, `${onde}.colunas[${i}].blocos[${j}]`, escopo)))
  }
  const base = new Set(decl)
  spec.blocos?.forEach((b: Obj, i: number) => bloco(b, `blocos[${i}]`, base))
  tpl(spec.titulo, 'titulo', base)
  tpl(spec.rodape, 'rodape', base, RESERVADOS)
  if (spec.fonte && !FONTES[spec.fonte]) erros.push(`fonte: "${spec.fonte}" não existe (use ${Object.keys(FONTES).join(', ')})`)
  return erros
}

/** os dados conferem com o declarado em spec.dados (presença e tipo)? */
export function confereDados(spec: Obj, dados: unknown): void {
  if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) throw new DocumentoErro('os dados do documento devem ser um objeto')
  for (const [nome, d] of Object.entries<Obj>(spec.dados ?? {})) {
    const v = (dados as Obj)[nome]
    if (!Object.hasOwn(dados, nome) || v === undefined || v === null) throw new DocumentoErro(`dado obrigatório ausente: ${nome}`, nome)
    if (!TIPOS_DADO[d.tipo]!(v)) throw new DocumentoErro(`o dado "${nome}" não é do tipo ${d.tipo}`, nome)
  }
}

export function resolve(spec: Obj, dadosEntrada: unknown): DocumentoResolvido {
  const erros = validaDocumento(spec); if (erros.length) throw new DocumentoErro(`documento inválido: ${erros.slice(0, 3).join('; ')}`)
  confereDados(spec, dadosEntrada)
  const dados = dadosEntrada as Obj
  let nBlocos = 0, nLinhas = 0

  const bloco = (b: Obj, d: Obj): Bloco[] => {
    if (b.repetir) {
      const { cada, como, limite = 200 } = b.repetir
      const lista = leCaminho(d, cada)
      if (!Array.isArray(lista)) throw new DocumentoErro(`repetir.cada "${cada}" não é uma lista`)
      if (lista.length > limite) throw new DocumentoErro(`a lista "${cada}" tem ${lista.length} itens (limite ${limite})`)
      return lista.flatMap((item) => bloco({ ...b, repetir: undefined }, { ...d, [como]: item }))
    }
    if (b.se !== undefined && !verdadeiro(b.se, d)) return []
    if (++nBlocos > MAX_BLOCOS) throw new DocumentoErro(`documento com mais de ${MAX_BLOCOS} blocos`)
    const t = (x: string | undefined) => interpola(x, d)
    switch (b.tipo) {
      case 'espaco': return [{ tipo: 'espaco', altura: b.altura ?? 8 }]
      case 'barraSecao': return [{ tipo: 'barraSecao', texto: t(b.texto), variante: b.variante ?? 'secao' }]
      case 'paragrafo': return [{ tipo: 'paragrafo', texto: t(b.texto), ...estilo(b) }]
      case 'campo': return [{ tipo: 'campo', rotulo: t(b.rotulo), valor: t(b.valor), ...(b.estiloValor ? { estiloValor: estilo(b.estiloValor) } : {}) }]
      case 'colunas': return [{ tipo: 'colunas', espacamento: b.espacamento ?? 16, colunas: b.colunas.map((c: Obj) => ({ flex: c.flex ?? 1, blocos: c.blocos.flatMap((x: Obj) => bloco(x, d)) })) }]
      case 'tabela': {
        const cel = (c: unknown, dd: Obj): Celula => typeof c === 'string' ? { principal: interpola(c, dd) } : { principal: interpola((c as Obj).principal, dd), ...((c as Obj).secundario ? { secundario: interpola((c as Obj).secundario, dd) } : {}), ...((c as Obj).alinhamento ? { alinhamento: (c as Obj).alinhamento } : {}), ...((c as Obj).peso ? { peso: (c as Obj).peso } : {}) }
        const linhas: Celula[][] = (b.linhas ?? []).map((l: unknown[]) => l.map((c) => cel(c, d)))
        if (b.linhasDe) {
          const { cada, como, limite = 500, celulas } = b.linhasDe
          const lista = leCaminho(d, cada)
          if (!Array.isArray(lista)) throw new DocumentoErro(`linhasDe.cada "${cada}" não é uma lista`)
          if (lista.length > limite) throw new DocumentoErro(`a lista "${cada}" tem ${lista.length} itens (limite ${limite})`)
          for (const item of lista) linhas.push(celulas.map((c: unknown) => cel(c, { ...d, [como]: item })))
        }
        nLinhas += linhas.length; if (nLinhas > MAX_LINHAS_TOTAL) throw new DocumentoErro('linhas de tabela demais')
        return [{ tipo: 'tabela', colunas: b.colunas.map((c: Obj) => ({ cabecalho: t(c.cabecalho), flex: c.flex ?? 1, ...(c.alinhamento ? { alinhamento: c.alinhamento } : {}) })), linhas }]
      }
      case 'resumo': return [{ tipo: 'resumo', larguraFracao: b.larguraFracao ?? 0.5, linhas: b.linhas.map((l: Obj) => ({ rotulo: t(l.rotulo), valor: t(l.valor), ...(l.forte ? { forte: true } : {}) })) }]
      case 'assinaturas': return [{ tipo: 'assinaturas', itens: b.itens.map((i: Obj) => ({ rotulo: t(i.rotulo) })) }]
      case 'imagem': {
        const src = t(b.src)
        // só data URL png/jpeg: o gerador NUNCA busca URL (sem SSRF, sem arquivo local) e o PDF/HTML não dependem de rede
        if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(src)) throw new DocumentoErro('imagem: só data URL png/jpeg em base64')
        if (src.length > 3_000_000) throw new DocumentoErro('imagem maior que ~2 MB')
        return [{ tipo: 'imagem', src, largura: b.largura ?? 80, altura: b.altura ?? 40, ...(b.alinhamento ? { alinhamento: b.alinhamento } : {}), alt: t(b.alt) }]
      }
      default: throw new DocumentoErro(`bloco desconhecido: ${String(b.tipo)}`)
    }
  }

  const m = spec.margem ?? {}
  return {
    tamanho: spec.tamanho, paisagem: spec.orientacao === 'paisagem',
    margemMm: { topo: m.topo ?? 12, direita: m.direita ?? 12, baixo: m.baixo ?? 12, esquerda: m.esquerda ?? 12 },
    fonte: spec.fonte ?? FONTE_PADRAO, ...(spec.rodape ? { rodape: spec.rodape } : {}), dados,
    titulo: interpola(spec.titulo, dados) || 'Documento',
    blocos: (spec.blocos ?? []).flatMap((b: Obj) => bloco(b, dados)),
  }
}
