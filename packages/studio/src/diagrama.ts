// Diagramas do Studio, gerados do JSON (núcleo puro: sem I/O, sem DOM). Dois desenhos:
//   · diagrama de BLOCOS: a árvore `spec.raiz` de uma página (bloco, slot, o texto principal, `se` e `repetir`), com o bloco selecionado em destaque;
//   · fluxo da APLICAÇÃO: páginas, formulários, dados e serviços do tenant, ligados pelo que os nós declaram (links, `navegar`, formulário na página,
//     dados da página, envio do formulário, guarda de sessão).
// A saída é SVG em texto, e TODO texto vindo do JSON é escapado; os limites impedem que um nó hostil gere um desenho gigante.
import { percorre, type Inst } from './arvore'

export const LIMITES_DIAGRAMA = { blocos: 300, paginas: 80, formularios: 60, dados: 60, arestas: 600 }

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** tira quebras e caracteres de controle: o texto vai para uma linha só do desenho */
const linha = (s: unknown) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()

const ESTILO = `
:root{--fundo:#fff;--texto:#1b2430;--suave:#5b6675;--caixa:#f4f6fa;--borda:#b6c0cf;--destaque:#1d5fd1;--aviso:#b3261e;--seta:#7b8798;--pagina:#e8f0ff;--form:#fff3e0;--dados:#e6f6ec;--servico:#efe9fb}
@media (prefers-color-scheme: dark){:root{--fundo:#12161c;--texto:#e6eaf0;--suave:#9aa6b6;--caixa:#1b222b;--borda:#3a4656;--destaque:#6ea0ff;--aviso:#ff8a80;--seta:#7b8798;--pagina:#1b2a44;--form:#3a2b14;--dados:#14301f;--servico:#2a2145}}
body{margin:0;background:var(--fundo);color:var(--texto);font:12px/1.3 system-ui,sans-serif}
svg{display:block;font:12px system-ui,sans-serif}
.cx{fill:var(--caixa);stroke:var(--borda);stroke-width:1}
.cx.pagina{fill:var(--pagina)}.cx.formulario{fill:var(--form)}.cx.dados{fill:var(--dados)}.cx.servico{fill:var(--servico)}
.cx.sel{stroke:var(--destaque);stroke-width:2.5}.cx.falta{stroke:var(--aviso);stroke-dasharray:4 3;fill:none}
.t1{fill:var(--texto);font-weight:600}.t2{fill:var(--suave);font-size:11px}.rot{fill:var(--suave);font-size:10px}
.lig{fill:none;stroke:var(--seta);stroke-width:1.3}.lig.tracejada{stroke-dasharray:5 4}.lig.erro{stroke:var(--aviso)}
.seta{fill:var(--seta)}.col{fill:var(--suave);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
`

const SVG = (largura: number, altura: number, corpo: string, titulo: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(titulo)}" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}"><title>${esc(titulo)}</title>` +
  `<defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="seta" d="M0 0L10 5L0 10z"/></marker></defs>${corpo}</svg>`

/** o documento que o `midia/quadro` (iframe sem permissões) mostra */
export const paginaDoDiagrama = (svg: string) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${ESTILO}</style><body>${svg}</body></html>`

// ---------------------------------------------------------------------------------------------------- blocos
export type DiagramaDeBlocos = { svg: string; blocos: number; truncado: boolean }

const PROPS_DE_TEXTO = ['texto', 'titulo', 'rotulo', 'href', 'formulario', 'nome', 'src', 'alt']
const dica = (i: Inst): string => {
  const p = i.props ?? {}
  for (const k of PROPS_DE_TEXTO) { const v = Object.hasOwn(p, k) ? p[k] : undefined; if (typeof v === 'string' && v.trim()) return `${k === 'texto' || k === 'titulo' ? '' : `${k}: `}${linha(v)}` }
  return ''
}

/** a árvore da página, da esquerda para a direita: cada coluna é um nível, cada linha uma folha; o pai fica no meio dos filhos */
export function diagramaDeBlocos(raiz: Inst, o: { selecionado?: string } = {}): DiagramaDeBlocos {
  const L = 190, A = 40, GX = 54, GY = 10, MARGEM = 14
  type N = { inst: Inst; slot: string; filhos: N[]; y: number; nivel: number }
  let total = 0, truncado = false
  const monta = (inst: Inst, slot: string, nivel: number): N => {
    total++
    const n: N = { inst, slot, filhos: [], y: 0, nivel }
    for (const [s, lista] of Object.entries(inst.slots ?? {})) {
      for (const f of Array.isArray(lista) ? lista : []) {
        if (total >= LIMITES_DIAGRAMA.blocos || nivel >= 32) { truncado = true; return n }
        if (f && typeof f === 'object' && typeof (f as Inst).bloco === 'string') n.filhos.push(monta(f as Inst, s, nivel + 1))
      }
    }
    return n
  }
  const arvore = monta(raiz, '', 0)
  let linhaAtual = 0, maxNivel = 0
  const posiciona = (n: N): void => {
    maxNivel = Math.max(maxNivel, n.nivel)
    if (!n.filhos.length) { n.y = linhaAtual++ * (A + GY); return }
    for (const f of n.filhos) posiciona(f)
    n.y = (n.filhos[0]!.y + n.filhos[n.filhos.length - 1]!.y) / 2
  }
  posiciona(arvore)
  const x = (n: N) => MARGEM + n.nivel * (L + GX), y = (n: N) => MARGEM + n.y
  let ligs = '', caixas = ''
  const desenha = (n: N): void => {
    for (const f of n.filhos) {
      const x1 = x(n) + L, y1 = y(n) + A / 2, x2 = x(f), y2 = y(f) + A / 2, m = (x1 + x2) / 2
      ligs += `<path class="lig" d="M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}" marker-end="url(#seta)"/>`
      if (f.slot && f.slot !== 'filhos') ligs += `<text class="rot" x="${x2 - GX + 6}" y="${y2 - 4}">${esc(corta(f.slot, 8))}</text>`
      desenha(f)
    }
    const sel = !!o.selecionado && n.inst.id === o.selecionado
    const marcas = [n.inst.se !== undefined ? 'se' : '', n.inst.repetir !== undefined ? 'repetir' : ''].filter(Boolean).join(' · ')
    const d = [dica(n.inst), marcas].filter(Boolean).join('  ·  ')
    caixas += `<g><rect class="cx${sel ? ' sel' : ''}" x="${x(n)}" y="${y(n)}" width="${L}" height="${A}" rx="6"/>` +
      `<text class="t1" x="${x(n) + 8}" y="${y(n) + 16}">${esc(corta(linha(n.inst.bloco), 26))}</text>` +
      (d ? `<text class="t2" x="${x(n) + 8}" y="${y(n) + 31}">${esc(corta(d, 30))}</text>` : '') +
      (n.inst.id ? `<title>${esc(`${linha(n.inst.bloco)} #${linha(n.inst.id)}`)}</title>` : '') + '</g>'
  }
  desenha(arvore)
  const largura = MARGEM * 2 + (maxNivel + 1) * L + maxNivel * GX, altura = MARGEM * 2 + Math.max(1, linhaAtual) * (A + GY) - GY
  return { svg: SVG(largura, altura, ligs + caixas, 'Diagrama de blocos da página'), blocos: total, truncado }
}

// ---------------------------------------------------------------------------------------------------- fluxo
type NoGenerico = { id: string; spec?: Record<string, unknown> }
export type EntradaDoFluxo = {
  paginas: NoGenerico[]
  formularios: NoGenerico[]
  dados: NoGenerico[]
  /** a rota de login do tenant (`tenant.spec.rotaLogin`); sem ela vale `/entrar` se existir */
  rotaLogin?: string
}
export type TipoDeNo = 'pagina' | 'formulario' | 'dados' | 'servico' | 'falta'
export type NoDoFluxo = { chave: string; tipo: TipoDeNo; titulo: string; detalhe: string }
export type ArestaDoFluxo = { de: string; para: string; rotulo: string; estilo: 'normal' | 'tracejada' | 'erro' }
export type Fluxo = { nos: NoDoFluxo[]; arestas: ArestaDoFluxo[]; avisos: string[]; truncado: boolean }

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** todos os destinos de `navegar` dentro de um trecho de JSON (eventos de bloco, ações de formulário…) */
function destinosDeNavegar(v: unknown, out: string[] = [], n = { c: 0 }): string[] {
  if (++n.c > 5000 || out.length > 200) return out
  if (Array.isArray(v)) { for (const x of v) destinosDeNavegar(x, out, n); return out }
  const o = obj(v); if (!o) return out
  if (o.acao === 'navegar' && typeof o.para === 'string') out.push(o.para)
  for (const x of Object.values(o)) if (x && typeof x === 'object') destinosDeNavegar(x, out, n)
  return out
}

/** casa um destino (`/produtos?x=1`, `/p/12`) com a rota de uma página (`/produtos`, `/p/:id`); externo e dinâmico não casam */
const casador = (rotas: Array<{ chave: string; rota: string }>) => {
  const regs = rotas.map((r) => ({ chave: r.chave, re: new RegExp(`^${r.rota.split('/').map((s) => (s.startsWith(':') || s === '*' ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}/?$`) }))
  return (destino: string): string | undefined => {
    if (!destino.startsWith('/') || destino.startsWith('//') || destino.includes('{')) return undefined
    const caminho = destino.split(/[?#]/)[0]!
    return regs.find((r) => r.re.test(caminho))?.chave
  }
}

export function fluxoDaAplicacao(e: EntradaDoFluxo): Fluxo {
  const nos = new Map<string, NoDoFluxo>(), arestas: ArestaDoFluxo[] = [], avisos: string[] = [], vistas = new Set<string>()
  let truncado = false
  const paginas = e.paginas.slice(0, LIMITES_DIAGRAMA.paginas), formularios = e.formularios.slice(0, LIMITES_DIAGRAMA.formularios), dados = e.dados.slice(0, LIMITES_DIAGRAMA.dados)
  if (e.paginas.length > paginas.length || e.formularios.length > formularios.length || e.dados.length > dados.length) truncado = true
  const poe = (n: NoDoFluxo) => { if (!nos.has(n.chave)) nos.set(n.chave, n) }
  const liga = (de: string, para: string, rotulo: string, estilo: ArestaDoFluxo['estilo'] = 'normal') => {
    const k = `${de}|${para}|${rotulo}`
    if (vistas.has(k) || de === para && estilo === 'normal') return
    if (arestas.length >= LIMITES_DIAGRAMA.arestas) { truncado = true; return }
    vistas.add(k); arestas.push({ de, para, rotulo, estilo })
  }
  const rotaDe = (p: NoGenerico) => texto(p.spec?.rota) ?? ''
  for (const p of paginas) poe({ chave: `pagina:${p.id}`, tipo: 'pagina', titulo: rotaDe(p) || p.id, detalhe: linha(texto(p.spec?.titulo) ?? p.id) })
  for (const f of formularios) poe({ chave: `formulario:${f.id}`, tipo: 'formulario', titulo: f.id, detalhe: `${lista(f.spec?.campos).length} campo(s)` })
  for (const d of dados) poe({ chave: `dados:${d.id}`, tipo: 'dados', titulo: d.id, detalhe: '' })
  const acha = casador(paginas.filter((p) => rotaDe(p).startsWith('/')).map((p) => ({ chave: `pagina:${p.id}`, rota: rotaDe(p) })))
  const servico = (nome: string, operacao: string) => { const chave = `servico:${nome}`; poe({ chave, tipo: 'servico', titulo: nome, detalhe: '' }); return { chave, operacao } }
  const semPagina = (destino: string) => { const chave = `falta:${destino.split(/[?#]/)[0]}`; poe({ chave, tipo: 'falta', titulo: corta(destino.split(/[?#]/)[0]!, 28), detalhe: 'sem página' }); return chave }
  const destino = (de: string, alvo: string, rotulo: string) => {
    if (!alvo.startsWith('/') || alvo.startsWith('//') || alvo.includes('{')) return // externo ou calculado: fora do mapa
    const k = acha(alvo); if (k) { liga(de, k, rotulo); return }
    if (truncado) return // com páginas cortadas, "sem página" seria palpite
    if ([...nos.values()].filter((n) => n.tipo === 'falta').length >= 20 && !nos.has(`falta:${alvo.split(/[?#]/)[0]}`)) return
    liga(de, semPagina(alvo), rotulo, 'erro'); avisos.push(`${nos.get(de)?.titulo ?? de} aponta para ${alvo}, que não é rota de nenhuma página`)
  }
  const login = e.rotaLogin ? acha(e.rotaLogin) : acha('/entrar')

  for (const p of paginas) {
    const de = `pagina:${p.id}`, raiz = obj(p.spec?.raiz) as unknown as Inst | undefined
    if (raiz && typeof raiz.bloco === 'string') {
      let visitados = 0
      for (const { inst } of percorre(raiz)) {
        if (++visitados > LIMITES_DIAGRAMA.blocos * 4) { truncado = true; break }
        const props = obj(inst.props) ?? {}
        if (typeof props.href === 'string') destino(de, props.href, linha(texto(props.texto) ?? 'link'))
        if (typeof props.formulario === 'string' && nos.has(`formulario:${props.formulario}`)) liga(de, `formulario:${props.formulario}`, 'formulário')
        for (const d of destinosDeNavegar(inst.eventos)) destino(de, d, 'navegar')
      }
    }
    for (const v of Object.values(obj(p.spec?.dados) ?? {}).slice(0, 100)) {
      const id = texto(v) ?? texto(obj(v)?.dados)
      if (id && nos.has(`dados:${id}`)) liga(de, `dados:${id}`, 'dados')
    }
    if (lista(p.spec?.guarda).length && login && login !== de) liga(de, login, 'sem sessão', 'tracejada')
  }
  for (const f of formularios) {
    const de = `formulario:${f.id}`, envio = obj(f.spec?.envio)
    const nome = texto(envio?.servico), op = texto(envio?.operacao)
    if (nome) { const s = servico(nome, op ?? ''); liga(de, s.chave, op ? `envia: ${op}` : 'envia') }
    else if (texto(envio?.sistema)) liga(de, de, `sistema: ${texto(envio?.sistema)}`, 'tracejada')
    for (const d of destinosDeNavegar(f.spec)) destino(de, d, 'depois de enviar')
    const v = texto(obj(f.spec?.valoresIniciais)?.dados); if (v && nos.has(`dados:${v}`)) liga(`dados:${v}`, de, 'valores iniciais')
  }
  for (const d of dados) {
    const fonte = obj(d.spec?.fonte), nome = texto(fonte?.servico), op = texto(fonte?.operacao)
    const n = nos.get(`dados:${d.id}`)!
    if (nome) { const s = servico(nome, op ?? ''); n.detalhe = op ?? ''; liga(`dados:${d.id}`, s.chave, op ?? 'consulta') }
    else if (texto(fonte?.tipo)) n.detalhe = String(texto(fonte?.tipo))
  }
  return { nos: [...nos.values()], arestas, avisos: avisos.slice(0, 20), truncado }
}

const COLUNAS: Array<{ tipo: TipoDeNo[]; titulo: string }> = [
  { tipo: ['pagina', 'falta'], titulo: 'Páginas' }, { tipo: ['formulario'], titulo: 'Formulários' }, { tipo: ['dados'], titulo: 'Dados' }, { tipo: ['servico'], titulo: 'Serviços' },
]

/** o fluxo em colunas (páginas · formulários · dados · serviços); ligações dentro da mesma coluna dão a volta pela esquerda */
export function desenhaFluxo(f: Fluxo): { svg: string; nos: number; arestas: number } {
  const L = 200, A = 40, GX = 120, GY = 14, TOPO = 26, MARGEM = 14
  const colunas = COLUNAS.map((c) => ({ ...c, itens: f.nos.filter((n) => c.tipo.includes(n.tipo)).sort((a, b) => a.titulo.localeCompare(b.titulo)) })).filter((c) => c.itens.length)
  const pos = new Map<string, { x: number; y: number }>()
  let corpo = '', altura = 0
  colunas.forEach((c, ci) => {
    const x = MARGEM + 40 + ci * (L + GX)
    corpo += `<text class="col" x="${x}" y="${MARGEM + 10}">${esc(c.titulo)}</text>`
    c.itens.forEach((n, i) => { const y = MARGEM + TOPO + i * (A + GY); pos.set(n.chave, { x, y }); altura = Math.max(altura, y + A) })
  })
  let ligs = '', caixas = ''
  f.arestas.forEach((a, i) => {
    const p = pos.get(a.de), q = pos.get(a.para); if (!p || !q) return
    const cls = `lig${a.estilo === 'normal' ? '' : ` ${a.estilo}`}`
    let d: string, tx: number, ty: number
    if (a.de === a.para) { const x = p.x + L, y = p.y + A / 2; d = `M${x} ${y - 8}C${x + 36} ${y - 26} ${x + 36} ${y + 26} ${x} ${y + 8}`; tx = x + 22; ty = y - 12 }
    else if (p.x === q.x) { const gap = 22 + (i % 4) * 8, x = p.x, y1 = p.y + A / 2, y2 = q.y + A / 2; d = `M${x} ${y1}C${x - gap} ${y1} ${x - gap} ${y2} ${x} ${y2}`; tx = x - gap - 2; ty = (y1 + y2) / 2 }
    else { const dir = q.x > p.x ? 1 : -1, x1 = dir > 0 ? p.x + L : p.x, x2 = dir > 0 ? q.x : q.x + L, y1 = p.y + A / 2, y2 = q.y + A / 2, m = (x1 + x2) / 2; d = `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`; tx = m; ty = (y1 + y2) / 2 - 3 }
    ligs += `<path class="${cls}" d="${d}" marker-end="url(#seta)"/>`
    if (a.rotulo) ligs += `<text class="rot" x="${tx}" y="${ty}" text-anchor="${p.x === q.x ? 'end' : 'middle'}">${esc(corta(a.rotulo, 22))}</text>`
  })
  for (const n of f.nos) {
    const p = pos.get(n.chave); if (!p) continue
    caixas += n.tipo === 'falta'
      ? `<g><rect class="cx falta" x="${p.x}" y="${p.y}" width="${L}" height="${A}" rx="6"/><text class="t1" x="${p.x + 8}" y="${p.y + 17}">${esc(corta(n.titulo, 26))}</text><text class="t2" x="${p.x + 8}" y="${p.y + 32}">${esc(n.detalhe)}</text></g>`
      : `<g><rect class="cx ${n.tipo}" x="${p.x}" y="${p.y}" width="${L}" height="${A}" rx="6"/><text class="t1" x="${p.x + 8}" y="${p.y + 17}">${esc(corta(n.titulo, 26))}</text>${n.detalhe ? `<text class="t2" x="${p.x + 8}" y="${p.y + 32}">${esc(corta(n.detalhe, 30))}</text>` : ''}</g>`
  }
  const largura = MARGEM * 2 + 40 + Math.max(1, colunas.length) * L + Math.max(0, colunas.length - 1) * GX + 60
  return { svg: SVG(largura, Math.max(altura, MARGEM + TOPO + A) + MARGEM, corpo + ligs + caixas, 'Fluxo da aplicação'), nos: f.nos.length, arestas: f.arestas.length }
}
