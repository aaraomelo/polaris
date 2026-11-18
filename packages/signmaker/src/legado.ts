// Conversor das configurações de banner do sistema legado (easysync-banner-app: globals, modifiers, complements, geometries) para nós `cartaz`.
// Replica o MESMO caminho de resolução do legado (getTransformations: globals → complements por tipo → modifiers por nome → propriedades) e traduz cada nó para um elemento.
// Não é perfeito por desenho: tudo que não foi traduzido vai para o RELATÓRIO (nunca se perde em silêncio).
type Obj = Record<string, any>
export type Relatorio = { avisos: string[]; naoConvertidos: string[] }
export type Convertido = { id: string; no: Obj; geometria: { dynamic: string; sizes: string[]; orientation: string } }

const TAMANHOS = new Set(['A4', 'A5', 'A6', 'A7'])
const FAMILIAS_CONHECIDAS = new Set(['Montserrat', 'Roboto'])
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
const limpaPow = (t: string) => t.replace(/\$pow\(([^)]*)\)/g, (_, x: string) => (/^[Mm]2$/.test(x) ? 'm²' : /^\d+$/.test(x) ? [...x].map((c) => SUP[c]).join('') : x))
const camel = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase())
const n = (v: number) => Number(v.toFixed(4))

/** o nó do legado depois de globals, complements e modifiers (o mesmo que getTransformations faz antes de desenhar) */
function resolveNo(cfg: Obj, node: Obj): Obj {
  const globalizado = { ...cfg.globals, ...node }
  const comp = (cfg.complements ?? []).reduce((acc: Obj, { type, ...resto }: Obj) => (arr(type).includes(globalizado.type) ? { ...acc, ...resto } : acc), {})
  const complementado: Obj = { ...comp, ...globalizado }
  if (globalizado.modifiers && comp.modifiers) complementado.modifiers = [...new Set([...arr(globalizado.modifiers), ...arr(comp.modifiers)])]
  const mods = (cfg.modifiers ?? []).reduce((acc: Obj, { type, ...resto }: Obj) => (arr(complementado.modifiers).includes(type) ? { ...acc, ...resto } : acc), {})
  return { ...complementado, ...mods }
}

class Ctx {
  dados = new Set<string>(); calculos: Obj = {}; avisos: string[]; naoConvertidos: string[]
  constructor(r: Relatorio) { this.avisos = r.avisos; this.naoConvertidos = r.naoConvertidos }
  raizes(t: string) { for (const m of t.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)*\s*(?:\|[^}]*)?\}/g)) this.dados.add(m[1]!) }
  caminho(c: string) { this.dados.add(c.split('.')[0]!); return c }
}

/** `text` do legado (texto ou {value, params}) → modelo de texto do cartaz; as funções viram `calculos` */
function modelo(cx: Ctx, id: string, text: unknown): string {
  if (typeof text === 'number') return String(text)
  if (typeof text === 'string') { const t = limpaPow(text); cx.raizes(t); return t }
  if (!text || typeof text !== 'object') return ''
  const { value, params } = text as { value: string; params: Obj[] }
  let t = limpaPow(String(value))
  for (const p of params ?? []) {
    const args = arr(p.args).map(String), fn = p.function ?? 'identity', marca = `{${p.type}}`
    if (fn === 'currency' && args.length === 1) { t = t.split(marca).join(`{${cx.caminho(args[0]!)} | num:2}`); continue }
    if (fn === 'identity' && args.length === 1) { t = t.split(marca).join(`{${cx.caminho(args[0]!)}}`); continue }
    const FN: Record<string, string> = { discount: 'desconto', percent: 'percentual', round: 'arredonda', installment: 'parcela', difference: 'diferenca', differencePercent: 'diferencaPercentual' }
    const funcao = FN[fn]; if (!funcao) { cx.naoConvertidos.push(`${id}: função ${fn} sem equivalente`); continue }
    const nome = camel(`${id} ${p.type}`).slice(0, 30)
    cx.calculos[nome] = { funcao, args: args.map((a) => cx.caminho(a)), ...(p.default !== undefined ? { padrao: String(p.default) } : {}) }
    cx.dados.add('calculo')
    t = t.split(marca).join(['desconto', 'parcela', 'diferenca'].includes(funcao) ? `{calculo.${nome} | num:2}` : `{calculo.${nome}}`)
  }
  cx.raizes(t); return t
}

function condicoes(cx: Ctx, id: string, props: Obj[] | undefined): { se?: string; cores?: Array<{ se: string; cor: number[] }> } {
  const vis = (props ?? []).filter((p) => p.type === 'visibility'), out: { se?: string; cores?: Array<{ se: string; cor: number[] }> } = {}
  const expr = (p: Obj, invertido: boolean): string => {
    cx.caminho(p.key); const vs = arr(p.value ?? true)
    if (vs.length === 1) { const v = vs[0]; return v === true ? `${invertido ? '!' : ''}${p.key}` : `${p.key} ${invertido ? '!=' : '=='} ${typeof v === 'string' ? JSON.stringify(v) : String(v)}` }
    if (invertido) { cx.naoConvertidos.push(`${id}: 'não em lista' (${p.key})`); return p.key }
    return `${p.key} em [${vs.map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(', ')}]`
  }
  if (vis.length > 1) cx.naoConvertidos.push(`${id}: ${vis.length} condições de visibilidade (a gramática aceita uma); usada só a primeira`)
  if (vis[0]) out.se = expr(vis[0], !!vis[0].inverted)
  const cores = (props ?? []).filter((p) => p.type === 'color').map((p) => {
    const cor = p.properties?.color; const resto = Object.keys(p.properties ?? {}).filter((k) => k !== 'color')
    if (resto.length) cx.naoConvertidos.push(`${id}: propriedades ${resto.join(',')} da cor condicional não convertidas`)
    return cor ? { se: expr({ key: p.key, value: p.value }, false), cor } : null
  }).filter(Boolean) as Array<{ se: string; cor: number[] }>
  if (cores.length) out.cores = cores
  return out
}

const alinhaH = (no: Obj): 'esquerda' | 'centro' | 'direita' => {
  if (no.margin) { const m = String(no.margin).split(/\s+/); if (m.length === 1 && m[0] === 'auto') return 'centro'; if (m.length === 4) return m[3] === 'auto' && m[1] !== 'auto' ? 'direita' : m[1] === 'auto' && m[3] !== 'auto' ? 'esquerda' : 'centro' }
  if (no.justifyContent === 'center') return 'centro'; if (no.justifyContent === 'end' || no.justifyContent === 'flex-end') return 'direita'
  const ta = no.textAlign ?? 'center'
  return ta === 'center' ? 'centro' : ta === 'end' || ta === 'right' ? 'direita' : 'esquerda'
}

export function converteGeometria(cfg: Obj, geo: Obj, o: { prefixo: string; relatorio: Relatorio }): Convertido | null {
  const r = o.relatorio, cx = new Ctx(r), horizontal = geo.orientation === 'landscape'
  const tamanhos = (geo.sizes as string[]).filter((s) => TAMANHOS.has(s)), id = `${o.prefixo}.${geo.dynamic}.${horizontal ? "paisagem" : "retrato"}`.toLowerCase().replace(/\+/g, "mais").replace(/[^a-z0-9._-]/g, "-")
  for (const s of geo.sizes as string[]) if (!TAMANHOS.has(s)) r.avisos.push(`${id}: tamanho ${s} não existe no Sign Maker (ignorado)`)
  if (!tamanhos.length) { r.avisos.push(`${id}: só tem tamanhos sem suporte; layout não convertido`); return null }
  const razao = horizontal ? 297 / 210 : 210 / 297 // largura/altura da página: converte tamanhos em fração da largura (QR) para fração da altura
  const elementos: Obj[] = [], usados = new Set<string>()
  const unico = (base: string) => { let k = camel(base) || 'el', i = 1; while (usados.has(k)) k = `${camel(base)}${++i}`; usados.add(k); return k }
  const fonteDe = (no: Obj) => {
    const fam = String(no.fontFamily ?? 'Montserrat').replace(/^./, (c) => c.toUpperCase()), peso = /bold/i.test(String(no.fontWeight ?? 'bold')) ? 'negrito' : 'normal'
    if (!FAMILIAS_CONHECIDAS.has(fam)) r.avisos.push(`fonte ${fam} é proprietária ou ausente do Sign Maker: trocada por Montserrat`)
    return { familia: FAMILIAS_CONHECIDAS.has(fam) ? fam : 'Montserrat', peso }
  }
  for (const filho of geo.children as Obj[]) {
    const no = resolveNo(cfg, filho), tipo = String(no.type), eid = unico(tipo), kind = no.elementType ?? 'text'
    const w = no.size !== undefined ? no.size : no.width, h = no.size !== undefined ? no.size * razao : no.height
    if (!(w > 0 && (no.size !== undefined ? h > 0 : no.height > 0))) { r.naoConvertidos.push(`${eid}: sem largura/altura (o legado também não desenha)`); continue }
    const caixa: Obj = { topo: n(no.top ?? 0), largura: n(w), altura: n(h) }; if (no.left !== undefined && no.left !== null) caixa.esquerda = n(no.left); else if (no.right !== undefined) caixa.direita = n(no.right); else caixa.esquerda = 0
    const base: Obj = { id: eid, caixa, ...condicoes(cx, eid, no.properties) }
    if (no.rotate) base.rotacao = n((no.rotate * 180) / Math.PI)
    const cor = no.color as number[] | undefined
    for (const k of Object.keys(no)) if (!['type', 'elementType', 'variant', 'text', 'code', 'params', 'top', 'left', 'right', 'width', 'height', 'size', 'color', 'background', 'borderRadius', 'textAlign', 'alignItems', 'justifyContent', 'margin', 'rotate', 'fontFamily', 'fontWeight', 'whiteSpace', 'modifiers', 'properties', 'padding', 'matrix', 'nowrap'].includes(k)) r.naoConvertidos.push(`${eid}: propriedade ${k} ignorada`)
    if (kind === 'price') {
      const t = no.text; const valor = typeof t === 'string' ? modelo(cx, eid, t) : (t?.params?.[0]?.args ? `{${cx.caminho(String(arr(t.params[0].args)[0]))}}` : '{price.price}')
      const antigo = /Old$/.test(no.variant ?? ''), sec = /^secondary/.test(no.variant ?? '')
      const el: Obj = { tipo: 'preco', ...base, valor, fonte: fonteDe(no), alinhaH: alinhaH(no), alinhaV: 'meio', centavos: { escala: antigo ? 1 : sec ? 0.65 : 0.6, posicao: antigo ? 'base' : 'alto' } }
      if (cor) el.cor = cor; if (antigo) el.riscado = { espessura: 2 }
      const un = arr(no.params)[0]; if (typeof un === 'string' && un) el.unidade = { texto: modelo(cx, eid, un) }
      elementos.push(el); continue
    }
    if (kind === 'barcode') {
      elementos.push({ tipo: 'codigoBarras', ...base, valor: modelo(cx, eid, no.text), ...(no.code ? { rotulo: modelo(cx, eid, no.code) } : {}), formato: 'code128', numero: 'cima', fundo: [255, 255, 255], raio: 0.12, fonte: fonteDe(no) }); continue
    }
    if (kind === 'qrcode') { elementos.push({ tipo: 'qrcode', ...base, valor: modelo(cx, eid, no.text), fundo: [255, 255, 255] }); continue }
    if (kind === 'validity') { elementos.push({ tipo: 'validade', ...base, data: modelo(cx, eid, no.text), fonte: fonteDe(no), ...(cor ? { cor } : {}) }); continue }
    if (kind === 'economize') {
      const bg = (no.background as number[] | undefined) ?? [200, 0, 0, 1]; if (!no.background) r.avisos.push(`${eid}: a imagem economize.png não foi portada; usando uma faixa`)
      const { topo, largura, altura } = caixa, esq = caixa.esquerda ?? 0, f = fonteDe(no)
      const sub = (fx: number, fy: number, fw: number, fh: number) => ({ topo: n(topo + fy * altura), esquerda: n(esq + fx * largura), largura: n(fw * largura), altura: n(fh * altura) })
      elementos.push({ tipo: 'faixa', id: `${eid}Fundo`, caixa, cor: bg.slice(0, 3), raio: Math.min(0.5, (no.borderRadius ?? 20) / 100), ...(base.se ? { se: base.se } : {}) },
        { tipo: 'texto', id: `${eid}Rotulo`, texto: 'ECONOMIZE', caixa: sub(0.125, 0.05, 0.75, 0.4), alinhaH: 'centro', alinhaV: 'meio', fonte: f, cor: cor ?? [255, 255, 255], ...(base.se ? { se: base.se } : {}) },
        { tipo: 'texto', id: `${eid}Valor`, texto: modelo(cx, eid, no.text), caixa: sub(0.15, 0.3, 0.7, 0.65), alinhaH: 'centro', alinhaV: 'meio', fonte: f, cor: cor ?? [255, 255, 255], ...(base.se ? { se: base.se } : {}) }); continue
    }
    const texto = modelo(cx, eid, no.text); if (!texto.trim()) continue
    const fundo = no.background as number[] | undefined, comFundo = !!fundo && fundo[3]! > 0
    if (comFundo && no.borderRadius) elementos.push({ tipo: 'faixa', id: `${eid}Fundo`, caixa, cor: fundo!.slice(0, 3), opacidade: fundo![3], raio: Math.min(0.5, no.borderRadius / 100), ...(base.se ? { se: base.se } : {}), ...(base.rotacao ? { rotacao: base.rotacao } : {}) })
    elementos.push({ tipo: 'texto', ...base, texto, fonte: fonteDe(no), alinhaH: alinhaH(no), alinhaV: no.alignItems === 'center' ? 'meio' : 'topo', ...(cor ? { cor } : {}), ...(comFundo && !no.borderRadius ? { fundo } : {}), ...(no.whiteSpace === 'nowrap' || no.nowrap ? { quebra: 'nenhuma' } : {}) })
  }
  if (!elementos.length) { r.avisos.push(`${id}: nenhum elemento convertido`); return null }
  const dados: Obj = {}; for (const d of [...cx.dados].sort()) if (d !== 'calculo') dados[d] = { tipo: 'json' }
  const spec: Obj = { tamanho: tamanhos[0], tamanhos, orientacao: horizontal ? 'paisagem' : 'retrato', titulo: `${o.prefixo} ${geo.dynamic}`, fundo: { cor: [255, 255, 255] }, fonte: { familia: 'Montserrat', peso: 'negrito' }, dados, ...(Object.keys(cx.calculos).length ? { calculos: cx.calculos } : {}), elementos }
  return { id, no: { kind: 'cartaz', id, versao: '1.0.0', estatuto: 'publicado', spec }, geometria: { dynamic: geo.dynamic, sizes: geo.sizes, orientation: geo.orientation } }
}

/** uma configuração inteira (um cliente): todas as geometrias; ids repetidos (mesma dinâmica e orientação com layouts/campanhas diferentes) ganham sufixo */
export function converteConfiguracao(cfg: Obj, prefixo: string): { nos: Convertido[]; relatorio: Relatorio } {
  const relatorio: Relatorio = { avisos: [], naoConvertidos: [] }, nos: Convertido[] = [], vistos = new Map<string, number>()
  for (const geo of cfg.geometries as Obj[]) {
    const c = converteGeometria(cfg, geo, { prefixo, relatorio }); if (!c) continue
    const k = vistos.get(c.id) ?? 0; vistos.set(c.id, k + 1)
    if (k) { c.id = `${c.id}${k + 1}`; c.no.id = c.id }
    nos.push(c)
  }
  relatorio.avisos = [...new Set(relatorio.avisos)]; relatorio.naoConvertidos = [...new Set(relatorio.naoConvertidos)]
  return { nos, relatorio }
}
