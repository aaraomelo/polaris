import { avaliaExpressao, rotuloPadrao, textoI18n, validaValores, type CampoSpec, type ErroCampo, type FormularioSpec, type ResultadoForm } from './validador'
import { aplicaMascara, type OpcoesMascara } from './mascara'
import { exibeDecimal, lerDecimal } from './formato'

// A ILHA do formulário: monta no navegador, a partir da definição (`kind: formulario`), os campos com máscara, validação (o MESMO motor do servidor), passos, ações e envio.
// Só DOM seguro: texto sempre por `textContent`, atributos só com valores validados pelo schema; nada de innerHTML. O servidor continua sendo quem decide (valida de novo no envio).

type Texto = string | Record<string, string>
type Ui = {
  ajuda?: Texto; placeholder?: Texto; rotuloAria?: Texto; autocompletar?: string; teclado?: string; colunas?: number
  opcoes?: Array<{ valor: string | number | boolean; rotulo?: Texto; desabilitado?: boolean; grupo?: string }> | { dados: string }
  campos?: Array<CampoSpec & Ui>
}
type CampoUi = CampoSpec & Ui
type AcaoPagina = { acao: string; para?: string }
type Def = Omit<FormularioSpec, 'campos'> & {
  titulo?: Texto; descricao?: Texto; campos: CampoUi[]
  secoes?: Array<{ id: string; titulo?: Texto; descricao?: Texto; campos: string[]; se?: string; colapsavel?: boolean; colunas?: number }>
  passos?: Array<{ id: string; titulo: Texto; descricao?: Texto; campos?: string[]; secoes?: string[]; se?: string }>
  validar?: { quando?: 'alterar' | 'sair' | 'enviar'; mostrarTodos?: boolean; focaPrimeiroErro?: boolean }
  envio?: { servico: string; operacao: string; idempotencia?: boolean; sucesso?: { mensagem?: Texto; limpar?: boolean; acoes?: AcaoPagina[] }; erro?: { mensagem?: Texto; acoes?: AcaoPagina[] } }
  acoes?: Array<{ id: string; rotulo: Texto; tipo: string; estilo?: string; se?: string; desabilitadoSe?: string; confirmar?: { titulo?: Texto; mensagem: Texto; rotuloConfirmar?: Texto; rotuloCancelar?: Texto }; acoes?: AcaoPagina[] }>
}
export type OpcoesIlha = {
  /** busca a definição (padrão: `GET /bff/formularios/:id`) */
  busca?: (id: string) => Promise<{ spec: Def; versao?: string }>
  /** faz o envio (padrão: `POST /bff/formularios/:id`); devolve o status e o corpo JSON */
  envia?: (id: string, corpo: unknown, chave: string) => Promise<{ status: number; corpo: unknown }>
  /** `navegar` das ações (padrão: `location.assign`) */
  navega?: (para: string) => void
  hoje?: () => string
  idioma?: string
}
export type Ilha = {
  el: HTMLElement
  /** valores como estão na tela (crus) */
  le(): Record<string, unknown>
  /** coloca valores na tela */
  poe(valores: Record<string, unknown>): void
  valida(): ResultadoForm
  envia(): Promise<void>
  limpa(): void
  passo(): number
}

const MASCARAS_DO_TIPO: Record<string, OpcoesMascara> = {
  cpf: { padrao: '000.000.000-00' }, cnpj: { padrao: '00.000.000/0000-00' }, cep: { padrao: '00000-000' }, telefone: { padrao: ['(00) 0000-0000', '(00) 00000-0000'] }, hora: { padrao: '00:00' },
}
/** a máscara que vale para o campo: a declarada, ou a padrão do tipo (CPF, CNPJ, CEP, telefone, hora; data conforme o formato) */
export function mascaraDoCampo(c: CampoSpec): OpcoesMascara | undefined {
  if (c.mascara) return c.mascara
  if (c.tipo === 'data') return { padrao: c.formato?.formatoData === 'yyyy-MM-dd' ? '0000-00-00' : '00/00/0000' }
  return MASCARAS_DO_TIPO[c.tipo]
}
/** onde fica o cursor depois de reformatar: depois do mesmo número de letras/dígitos que havia antes dele */
export function posicaoDoCursor(formatado: string, significativosAntes: number): number {
  if (significativosAntes <= 0) return 0
  let n = 0
  for (let i = 0; i < formatado.length; i++) { if (/[\p{L}\p{N}]/u.test(formatado[i]!)) { n++; if (n === significativosAntes) return i + 1 } }
  return formatado.length
}

export const CSS_FORMULARIO = `.pl-form{display:flex;flex-direction:column;gap:var(--espacamento-base,8px)}.pl-form fieldset{border:1px solid var(--cor-borda,#ccc);border-radius:var(--raio-pequeno,4px);padding:var(--espacamento-base,8px)}
.pl-campo{display:flex;flex-direction:column;gap:2px}.pl-campo[hidden]{display:none}.pl-campo input:not([type=checkbox]):not([type=radio]),.pl-campo select,.pl-campo textarea{padding:6px;border:1px solid var(--cor-borda,#ccc);border-radius:var(--raio-pequeno,4px);font:inherit}
.pl-campo [aria-invalid=true]{border-color:var(--cor-erro,#c0392b)}.pl-erro{color:var(--cor-erro,#c0392b);font-size:.9em}.pl-ajuda{color:var(--cor-texto-suave,#666);font-size:.9em}
.pl-acoes{display:flex;gap:var(--espacamento-base,8px);flex-wrap:wrap}.pl-acoes button{padding:6px 12px;border:1px solid var(--cor-borda,#ccc);border-radius:var(--raio-pequeno,4px);background:var(--cor-superficie,#fff);color:inherit;font:inherit;cursor:pointer}
.pl-acoes button[data-estilo=primario]{background:var(--cor-primaria,#1f4e79);color:var(--cor-texto-sobre-primaria,#fff);border-color:transparent}.pl-acoes button[data-estilo=perigo]{background:var(--cor-erro,#c0392b);color:#fff;border-color:transparent}.pl-acoes button:disabled{opacity:.6;cursor:default}
.pl-status{padding:6px;border-radius:var(--raio-pequeno,4px)}.pl-status[data-tom=sucesso]{border:1px solid var(--cor-sucesso,#2e7d32)}.pl-status[data-tom=erro]{border:1px solid var(--cor-erro,#c0392b)}.pl-passos{display:flex;gap:8px;padding:0;list-style:none}.pl-passos [aria-current=step]{font-weight:bold}`

let uidSeq = 0
const chaveAleatoria = () => { const b = new Uint8Array(16); (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') }
const seguro = (para: unknown): string | null => (typeof para === 'string' && para.startsWith('/') && !para.startsWith('//') && !/[\\\u0000-\u001f]/.test(para) ? para : null)

export async function montaFormulario(el: HTMLElement, opc: OpcoesIlha = {}): Promise<Ilha | null> {
  const id = el.getAttribute('data-polaris-formulario') ?? ''
  if (!id || el.getAttribute('data-pl-montado')) return null
  el.setAttribute('data-pl-montado', '1')
  const doc = el.ownerDocument
  const idioma = opc.idioma ?? el.getAttribute('data-polaris-idioma') ?? (doc.documentElement.lang || 'pt-BR')
  const busca = opc.busca ?? (async (i: string) => { const r = await fetch(`/bff/formularios/${encodeURIComponent(i)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ spec: Def }> })
  const envia = opc.envia ?? (async (i: string, corpo: unknown, chave: string) => {
    const r = await fetch(`/bff/formularios/${encodeURIComponent(i)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-polaris-form': '1', 'idempotency-key': chave }, body: JSON.stringify(corpo) })
    let c: unknown = null; try { c = await r.json() } catch { /* corpo vazio ou não JSON */ }
    return { status: r.status, corpo: c }
  })
  const navega = opc.navega ?? ((p: string) => { location.assign(p) })
  let def: Def
  try { def = (await busca(id)).spec } catch { el.removeAttribute('data-pl-montado'); el.setAttribute('aria-busy', 'false'); el.textContent = idioma.startsWith('en') ? 'Could not load the form.' : 'Não foi possível carregar o formulário.'; return null }
  let iniciais: Record<string, unknown> = {}
  try { const j = el.getAttribute('data-polaris-valores'); if (j) { const o = JSON.parse(j) as unknown; if (o && typeof o === 'object' && !Array.isArray(o)) iniciais = o as Record<string, unknown> } } catch { /* valores iniciais ilegíveis: ignora */ }

  const T = (t: Texto | undefined): string | undefined => textoI18n(t, idioma, def.idioma)
  const uid = `plf${++uidSeq}`
  if (!doc.getElementById('pl-form-css')) { const st = doc.createElement('style'); st.id = 'pl-form-css'; st.textContent = CSS_FORMULARIO; doc.head.appendChild(st) }
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, texto?: string): HTMLElementTagNameMap[K] => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (texto !== undefined) e.textContent = texto; return e }

  // ---- estado da tela ----------------------------------------------------------------------------------------------------------------
  const raiz = mk('form', { class: 'pl-form', novalidate: '', 'aria-labelledby': `${uid}-t` })
  const tocados = new Set<string>(); let tentou = false, enviando = false, passoAtual = 0, chaveEnvio = chaveAleatoria(), ultimo: ResultadoForm | null = null
  const controles = new Map<string, { caixa: HTMLElement; campo: CampoUi; tipo: string; leitura(): unknown; escrita(v: unknown): void; foco(): HTMLElement; erro: HTMLElement; entradas: HTMLElement[] }>()
  const status = mk('div', { class: 'pl-status', role: 'status', 'aria-live': 'polite', hidden: '' })
  const erroGeral = mk('div', { class: 'pl-erro', role: 'alert', hidden: '' })

  if (def.titulo) raiz.appendChild(mk('h2', { id: `${uid}-t` }, T(def.titulo)))
  else raiz.setAttribute('aria-label', id)
  if (def.descricao) raiz.appendChild(mk('p', {}, T(def.descricao)))

  // ---- construção dos campos -----------------------------------------------------------------------------------------------------------
  const rotuloDe = (c: CampoUi) => T(c.rotulo) ?? rotuloPadrao(c.nome)
  const INPUT_TIPO: Record<string, string> = { email: 'email', url: 'url', senha: 'password', telefone: 'tel' }

  function constroiCampo(c: CampoUi, caminho: string, pai: HTMLElement): void {
    const base = `${uid}-${caminho.replace(/[^A-Za-z0-9]/g, '_')}`
    const caixa = mk('div', { class: 'pl-campo', 'data-campo': caminho, 'data-tipo': c.tipo })
    if (c.colunas) caixa.setAttribute('style', `grid-column:span ${c.colunas}`)
    const ajuda = c.ajuda ? mk('small', { id: `${base}-ajuda`, class: 'pl-ajuda' }, T(c.ajuda)) : null
    const erro = mk('div', { id: `${base}-erro`, class: 'pl-erro', role: 'alert', hidden: '' })
    const desc = [ajuda ? `${base}-ajuda` : '', `${base}-erro`].filter(Boolean).join(' ')
    const marca = (e: HTMLElement, obrigatorio: boolean) => { e.setAttribute('aria-describedby', desc); if (obrigatorio) e.setAttribute('aria-required', 'true') }
    const reg = (leitura: () => unknown, escrita: (v: unknown) => void, entradas: HTMLElement[]) => controles.set(caminho, { caixa, campo: c, tipo: c.tipo, leitura, escrita, foco: () => entradas[0]!, erro, entradas })
    const rotulo = rotuloDe(c)
    const aoMexer = (e: HTMLElement) => { e.addEventListener('input', () => { chaveEnvio = chaveAleatoria(); atualiza(caminho, 'alterar') }); e.addEventListener('change', () => { chaveEnvio = chaveAleatoria(); atualiza(caminho, 'alterar') }); e.addEventListener('blur', () => atualiza(caminho, 'sair')) }

    if (c.tipo === 'oculto') {
      const e = mk('input', { type: 'hidden', name: c.nome }); if (c.padrao !== undefined) e.value = String(c.padrao); raiz.appendChild(e); reg(() => e.value, (v) => { e.value = v == null ? '' : String(v) }, [e]); return
    }
    if (c.tipo === 'booleano') {
      const e = mk('input', { type: 'checkbox', id: `${base}-c`, name: c.nome }); marca(e, c.obrigatorio === true); e.checked = c.padrao === true
      const l = mk('label', { for: `${base}-c` }); l.append(e, ' ', rotulo); caixa.append(l)
      reg(() => e.checked, (v) => { e.checked = v === true }, [e]); aoMexer(e)
    } else if (c.tipo === 'grupo' || c.tipo === 'lista' || c.tipo === 'multiescolha') {
      const fs = mk('fieldset', { id: `${base}-c` }); fs.appendChild(mk('legend', {}, rotulo)); caixa.append(fs)
      if (c.tipo === 'multiescolha') {
        const ops = Array.isArray(c.opcoes) ? c.opcoes : []; const checks: Array<[HTMLInputElement, unknown]> = []
        ops.forEach((o, i) => { const k = mk('input', { type: 'checkbox', id: `${base}-o${i}`, name: c.nome }); if (o.desabilitado) k.disabled = true; marca(k, false); const l = mk('label', { for: `${base}-o${i}` }); l.append(k, ' ', T(o.rotulo) ?? String(o.valor)); fs.append(l); checks.push([k, o.valor]); aoMexer(k) })
        reg(() => checks.filter(([k]) => k.checked).map(([, v]) => v), (v) => { const a = Array.isArray(v) ? v.map(String) : []; for (const [k, val] of checks) k.checked = a.includes(String(val)) }, checks.map(([k]) => k))
      } else if (c.tipo === 'grupo') {
        const sub = new Map<string, string>(); for (const f of c.campos ?? []) { constroiCampo(f, `${caminho}.${f.nome}`, fs); sub.set(f.nome, `${caminho}.${f.nome}`) }
        reg(() => Object.fromEntries([...sub].map(([n, cam]) => [n, controles.get(cam)!.leitura()])), (v) => { const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>; for (const [n, cam] of sub) controles.get(cam)!.escrita(o[n]) }, [fs])
      } else {
        const itens = mk('div', { class: 'pl-itens' }), add = mk('button', { type: 'button' }, idioma.startsWith('en') ? 'Add' : 'Adicionar'); fs.append(itens, add)
        let n = 0; const linhas: Array<{ caixa: HTMLElement; chave: number }> = []
        const adiciona = (vals?: Record<string, unknown>) => {
          const chave = n++, linhaCaixa = mk('div', { class: 'pl-item', 'data-item': String(chave) }), prefixo = `${caminho}.${chave}`
          for (const f of c.campos ?? []) constroiCampo(f, `${prefixo}.${f.nome}`, linhaCaixa)
          const rm = mk('button', { type: 'button' }, idioma.startsWith('en') ? 'Remove' : 'Remover'); rm.addEventListener('click', () => {
            for (const k of [...controles.keys()]) if (k.startsWith(`${prefixo}.`)) controles.delete(k)
            linhaCaixa.remove(); linhas.splice(linhas.findIndex((l) => l.chave === chave), 1)
            // os erros e o estado do validador usam a POSIÇÃO do item (`ends.1.rua`): depois de remover, os itens seguintes são renumerados para continuar batendo
            linhas.forEach((l, pos) => { if (l.chave === pos) return; const de = `${caminho}.${l.chave}.`, para = `${caminho}.${pos}.`; for (const [k, ctl] of [...controles]) if (k.startsWith(de)) { controles.delete(k); controles.set(para + k.slice(de.length), ctl); ctl.caixa.setAttribute('data-campo', para + k.slice(de.length)) } l.caixa.setAttribute('data-item', String(pos)); l.chave = pos })
            n = linhas.length; chaveEnvio = chaveAleatoria(); atualiza(caminho, 'alterar')
          })
          linhaCaixa.appendChild(rm); itens.appendChild(linhaCaixa); linhas.push({ caixa: linhaCaixa, chave })
          if (vals) for (const f of c.campos ?? []) controles.get(`${prefixo}.${f.nome}`)!.escrita(vals[f.nome])
        }
        add.addEventListener('click', () => { adiciona(); atualiza(caminho, 'alterar') })
        reg(() => linhas.map((l) => Object.fromEntries((c.campos ?? []).map((f) => [f.nome, controles.get(`${caminho}.${l.chave}.${f.nome}`)!.leitura()]))), (v) => { for (const k of [...controles.keys()]) if (k.startsWith(`${caminho}.`)) controles.delete(k); itens.textContent = ''; linhas.length = 0; n = 0; for (const it of Array.isArray(v) ? v : []) adiciona((it ?? {}) as Record<string, unknown>) }, [add])
        if ((c.validacao?.itensMinimo ?? 0) > 0 && iniciais[c.nome] === undefined && c.padrao === undefined) adiciona() // lista que exige itens começa com um
      }
    } else {
      const lab = mk('label', { for: `${base}-c` }, rotulo); caixa.append(lab)
      let e: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      if (c.tipo === 'textoLongo') e = mk('textarea', { rows: '4' })
      else if (c.tipo === 'escolha') {
        const s = mk('select'); const ops = Array.isArray(c.opcoes) ? c.opcoes : []
        s.appendChild(mk('option', { value: '' }, idioma.startsWith('en') ? 'Select…' : 'Selecione…'))
        const grupos = new Map<string, HTMLElement>()
        ops.forEach((o) => { const op = mk('option', { value: String(o.valor) }, T(o.rotulo) ?? String(o.valor)); if (o.desabilitado) op.disabled = true; let pai2: HTMLElement = s; if (o.grupo) { if (!grupos.has(o.grupo)) { const g = mk('optgroup', { label: o.grupo }); s.appendChild(g); grupos.set(o.grupo, g) } pai2 = grupos.get(o.grupo)! } pai2.appendChild(op) })
        e = s
      } else if (c.tipo === 'arquivo') e = mk('input', { type: 'file' })
      else {
        e = mk('input', { type: INPUT_TIPO[c.tipo] ?? 'text' })
        if (c.teclado) e.setAttribute('inputmode', c.teclado); else if (['numero', 'inteiro', 'dinheiro', 'percentual'].includes(c.tipo)) e.setAttribute('inputmode', c.tipo === 'inteiro' ? 'numeric' : 'decimal')
      }
      e.id = `${base}-c`; e.setAttribute('name', c.nome); marca(e, c.obrigatorio === true)
      if (c.autocompletar) e.setAttribute('autocomplete', c.autocompletar)
      const ph = T(c.placeholder); if (ph) e.setAttribute('placeholder', ph)
      if (c.tipo === 'senha') e.setAttribute('autocomplete', c.autocompletar ?? 'new-password')
      const masc = c.tipo === 'senha' ? undefined : mascaraDoCampo(c)
      if (masc && !ph && typeof masc.padrao === 'string') e.setAttribute('placeholder', masc.padrao.replace(/[09]/g, '0').replace(/[Aa*]/g, 'x'))
      if (masc && c.tipo !== 'escolha' && c.tipo !== 'arquivo') {
        e.addEventListener('input', () => {
          const inp = e as HTMLInputElement, antes = inp.value, pos = inp.selectionStart ?? antes.length
          const sig = [...antes.slice(0, pos)].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length
          const r = aplicaMascara(antes, masc)
          if (r.formatado !== antes) { inp.value = r.formatado; try { const p = posicaoDoCursor(r.formatado, sig); inp.setSelectionRange(p, p) } catch { /* tipo sem seleção (email) */ } }
        }, true) // captura: a máscara roda ANTES de a validação ler o valor
      }
      const dinheiro = c.tipo === 'dinheiro' || (c.tipo === 'numero' && c.formato?.casasDecimais !== undefined)
      if (dinheiro) e.addEventListener('blur', () => { const inp = e as HTMLInputElement, d = lerDecimal(inp.value, c.formato?.separadorDecimal ?? ','); if (d !== null) inp.value = exibeDecimal(d, { casasDecimais: c.formato?.casasDecimais ?? 2, separadorDecimal: c.formato?.separadorDecimal ?? ',', agrupaMilhar: (c.formato as { agrupaMilhar?: boolean } | undefined)?.agrupaMilhar === true }) }, true)
      if (c.padrao !== undefined && c.padrao !== null && c.tipo !== 'arquivo') (e as HTMLInputElement).value = typeof c.padrao === 'string' || typeof c.padrao === 'number' ? String(c.padrao) : ''
      caixa.append(e)
      if (c.tipo === 'arquivo') reg(() => { const f = (e as HTMLInputElement).files?.[0]; return f ? { nome: f.name, tamanho: f.size, tipo: f.type } : undefined }, () => { /* arquivo não é preenchido por valor */ }, [e])
      else reg(() => (e as HTMLInputElement).value, (v) => { (e as HTMLInputElement).value = v == null ? '' : String(v) }, [e])
      aoMexer(e)
    }
    if (ajuda) caixa.append(ajuda)
    caixa.append(erro); pai.append(caixa)
  }

  // ---- layout: seções ou passos -----------------------------------------------------------------------------------------------------
  const corpo = mk('div', { class: 'pl-corpo' }), cabPassos = def.passos ? mk('ol', { class: 'pl-passos' }) : null
  const porNome = new Map(def.campos.map((c) => [c.nome, c] as const))
  const blocos: Array<{ el: HTMLElement; se?: string; campos: string[]; passo: number }> = []
  const noPasso = (n: string) => { const i = (def.passos ?? []).findIndex((p) => (p.campos ?? []).includes(n) || (p.secoes ?? []).some((sid) => (def.secoes ?? []).find((s) => s.id === sid)?.campos.includes(n))); return i < 0 ? 0 : i }
  const secaoDe = new Map<string, NonNullable<Def['secoes']>[number]>(); for (const s of def.secoes ?? []) for (const n of s.campos) secaoDe.set(n, s)
  const feitas = new Set<string>()
  for (const c of def.campos) {
    const s = secaoDe.get(c.nome)
    if (s && !feitas.has(s.id)) {
      feitas.add(s.id); const fs = mk('fieldset', { class: 'pl-secao', 'data-secao': s.id }); if (s.titulo) fs.appendChild(mk('legend', {}, T(s.titulo))); if (s.descricao) fs.appendChild(mk('p', {}, T(s.descricao)))
      if (s.colunas && s.colunas > 1) fs.setAttribute('style', `display:grid;grid-template-columns:repeat(${s.colunas},1fr);gap:8px`)
      for (const n of s.campos) constroiCampo(porNome.get(n)!, n, fs)
      corpo.appendChild(fs); blocos.push({ el: fs, ...(s.se ? { se: s.se } : {}), campos: s.campos, passo: noPasso(c.nome) })
    } else if (!s) { const antes = corpo.childElementCount; constroiCampo(c, c.nome, corpo); const el = corpo.children[antes] as HTMLElement; if (el) blocos.push({ el, campos: [c.nome], passo: noPasso(c.nome) }) }
  }
  if (cabPassos) { (def.passos ?? []).forEach((p, i) => cabPassos.appendChild(mk('li', { 'data-passo': String(i) }, T(p.titulo)))); raiz.appendChild(cabPassos) }
  raiz.appendChild(corpo)

  // ---- ações -------------------------------------------------------------------------------------------------------------------------
  const acoes = def.acoes ?? (def.envio ? [{ id: 'enviar', rotulo: idioma.startsWith('en') ? 'Submit' : 'Enviar', tipo: 'enviar', estilo: 'primario' }] : [])
  const barra = mk('div', { class: 'pl-acoes' }), botoes = new Map<string, HTMLButtonElement>(); let confirmando: HTMLElement | null = null
  for (const a of acoes) {
    const b = mk('button', { type: a.tipo === 'enviar' ? 'submit' : 'button', 'data-acao': a.id, 'data-estilo': a.estilo ?? 'secundario' }, T(a.rotulo)); botoes.set(a.id, b); barra.appendChild(b)
    b.addEventListener('click', (ev) => {
      if (a.tipo === 'enviar') return // o submit do <form> cuida (valida e envia)
      ev.preventDefault(); void executaAcao(a)
    })
  }
  raiz.append(status, erroGeral, barra)

  const roda = (acs?: AcaoPagina[]) => { for (const a of acs ?? []) { if (a.acao === 'navegar') { const p = seguro(a.para); if (p) navega(p) } } }
  async function executaAcao(a: NonNullable<Def['acoes']>[number], confirmado = false): Promise<void> {
    if (a.confirmar && !confirmado) {
      confirmando?.remove(); const painel = mk('div', { class: 'pl-confirma', role: 'alertdialog', 'aria-label': T(a.confirmar.titulo) ?? T(a.rotulo) ?? '' }); painel.appendChild(mk('p', {}, T(a.confirmar.mensagem)))
      const ok = mk('button', { type: 'button', 'data-estilo': 'perigo' }, T(a.confirmar.rotuloConfirmar) ?? (idioma.startsWith('en') ? 'Confirm' : 'Confirmar')), nao = mk('button', { type: 'button' }, T(a.confirmar.rotuloCancelar) ?? (idioma.startsWith('en') ? 'Cancel' : 'Cancelar'))
      ok.addEventListener('click', () => { painel.remove(); confirmando = null; void executaAcao(a, true) }); nao.addEventListener('click', () => { painel.remove(); confirmando = null }); painel.append(ok, nao); barra.after(painel); confirmando = painel; ok.focus(); return
    }
    if (a.tipo === 'limpar') { limpa(); return }
    if (a.tipo === 'voltar') { irPara(passoAtual - 1); return }
    if (a.tipo === 'avancar') { if (validaPasso()) irPara(passoAtual + 1); return }
    roda(a.acoes)
  }

  // ---- leitura, validação e exibição -------------------------------------------------------------------------------------------------
  const le = (): Record<string, unknown> => Object.fromEntries(def.campos.map((c) => [c.nome, controles.get(c.nome)?.leitura()]))
  const opcoesValida = (quando?: 'alterar' | 'sair' | 'enviar', campos?: readonly string[]) => ({ idioma, hoje: (opc.hoje ?? (() => new Date().toISOString().slice(0, 10)))(), ...(quando ? { quando } : {}), ...(campos ? { campos } : {}) })
  const valida = (): ResultadoForm => validaValores(def as unknown as FormularioSpec, le(), opcoesValida('enviar'))
  const camposDoPasso = () => def.passos ? def.campos.map((c) => c.nome).filter((n) => noPasso(n) === passoAtual) : undefined

  function aplicaEstado(r: ResultadoForm): void {
    for (const [cam, ctl] of controles) {
      const st = r.estado[cam]; if (!st) continue
      ctl.caixa.hidden = !st.visivel; ctl.entradas.forEach((e) => { if (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement || e instanceof HTMLButtonElement) e.disabled = st.desabilitado || enviando; if (e.getAttribute('aria-required') !== null || st.obrigatorio) e.setAttribute('aria-required', String(st.obrigatorio)) })
      // campo calculado: o valor vem do servidor/cálculo
      if (ctl.campo.calculado !== undefined) { const v = lerPath(r.valores, cam); if (v !== undefined) ctl.escrita(v) }
    }
    for (const b of blocos) { const visivelPasso = !def.passos || b.passo === passoAtual; const se = b.se === undefined ? true : (() => { const x = avaliaExpressao(b.se, { valores: r.valores }); return x === undefined ? true : Boolean(x) })(); b.el.hidden = !(visivelPasso && se) || (b.campos.length > 0 && b.campos.every((n) => r.estado[n]?.visivel === false)) }
  }
  const lerPath = (o: Record<string, unknown>, cam: string): unknown => cam.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)

  function mostraErros(r: ResultadoForm, so?: Set<string>): void {
    const quando = def.validar?.quando ?? 'sair', todos = def.validar?.mostrarTodos === true
    for (const [cam, ctl] of controles) {
      const lista = (r.porCampo[cam] ?? []).filter(() => true)
      const exibe = tentou || (so ? so.has(cam) : (quando !== 'enviar' && tocados.has(cam)))
      const vis = exibe ? (todos ? lista : lista.slice(0, 1)) : []
      ctl.erro.textContent = vis.map((e) => e.mensagem).join(' '); ctl.erro.hidden = vis.length === 0
      ctl.entradas.forEach((e) => { if (vis.length) e.setAttribute('aria-invalid', 'true'); else e.removeAttribute('aria-invalid') })
    }
    const gerais = (r.porCampo._formulario ?? []).map((e) => e.mensagem); const extra = tentou ? gerais : []
    if (!enviando) { erroGeral.textContent = extra.join(' '); erroGeral.hidden = extra.length === 0 }
  }

  function atualiza(cam: string, evento: 'alterar' | 'sair'): void {
    const quando = def.validar?.quando ?? 'sair'
    if (evento === 'sair') tocados.add(cam)
    if (evento === 'alterar' && quando === 'alterar') tocados.add(cam)
    const r = validaValores(def as unknown as FormularioSpec, le(), opcoesValida(evento)); ultimo = r
    aplicaEstado(r); mostraErros(r)
    if (evento === 'alterar') { status.hidden = true }
  }

  function validaPasso(): boolean {
    const campos = camposDoPasso(); const r = validaValores(def as unknown as FormularioSpec, le(), opcoesValida('enviar', campos)); ultimo = r
    const meus = new Set(r.erros.map((e) => e.campo)); tentou = true; aplicaEstado(r); mostraErros(r, meus)
    if (!r.ok) { foca(r.erros); return false }
    tentou = false; return true
  }
  function foca(erros: ErroCampo[]): void {
    if (def.validar?.focaPrimeiroErro === false) return
    for (const c of def.campos) { const e = erros.find((x) => x.campo === c.nome || x.campo.startsWith(`${c.nome}.`)); if (e) { controles.get(e.campo)?.foco()?.focus?.(); return } }
  }
  function irPara(n: number): void { const total = def.passos?.length ?? 1; passoAtual = Math.min(Math.max(0, n), total - 1); cabPassos?.querySelectorAll('li').forEach((li, i) => { if (i === passoAtual) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current') }); atualizaBotoesPasso(); const r = validaValores(def as unknown as FormularioSpec, le(), opcoesValida()); aplicaEstado(r); status.hidden = true }
  function atualizaBotoesPasso(): void { const total = def.passos?.length ?? 1; for (const a of acoes) { const b = botoes.get(a.id)!; if (a.tipo === 'voltar') b.hidden = passoAtual === 0; if (a.tipo === 'avancar') b.hidden = passoAtual >= total - 1; if (a.tipo === 'enviar' && def.passos) b.hidden = passoAtual < total - 1 } }

  function limpa(): void {
    for (const c of def.campos) { const ctl = controles.get(c.nome); if (!ctl) continue; if (c.tipo === 'booleano') ctl.escrita(c.padrao === true); else ctl.escrita(c.padrao ?? (c.tipo === 'multiescolha' || c.tipo === 'lista' ? [] : '')) }
    tocados.clear(); tentou = false; chaveEnvio = chaveAleatoria(); status.hidden = true; erroGeral.hidden = true; irPara(0); const r = validaValores(def as unknown as FormularioSpec, le(), opcoesValida()); ultimo = r; aplicaEstado(r); mostraErros(r)
  }
  const poe = (v: Record<string, unknown>) => { for (const c of def.campos) if (Object.prototype.hasOwnProperty.call(v, c.nome)) controles.get(c.nome)?.escrita(v[c.nome]); const r = validaValores(def as unknown as FormularioSpec, le(), opcoesValida()); ultimo = r; aplicaEstado(r) }

  // ---- envio ---------------------------------------------------------------------------------------------------------------------------
  const em = (pt: string, en: string) => (idioma.startsWith('en') ? en : pt)
  async function enviaTudo(): Promise<void> {
    if (enviando) return
    tentou = true; const r = valida(); ultimo = r; aplicaEstado(r); mostraErros(r)
    if (!r.ok) { const p = def.passos ? Math.min(...r.erros.map((e) => noPasso(e.campo.split('.')[0]!))) : 0; if (Number.isFinite(p) && def.passos) irPara(p); foca(r.erros); el.dispatchEvent(new CustomEvent('polaris-erro', { detail: { erros: r.erros } })); return }
    if (!def.envio) { el.dispatchEvent(new CustomEvent('polaris-enviado', { detail: { valores: r.valores } })); return }
    enviando = true; raiz.setAttribute('aria-busy', 'true'); for (const b of botoes.values()) b.disabled = true; erroGeral.hidden = true; status.hidden = true
    try {
      const res = await envia(id, { valores: le(), idioma }, chaveEnvio)
      const corpo = (res.corpo ?? {}) as { ok?: boolean; resultado?: unknown; sucesso?: { mensagem?: string; limpar?: boolean; acoes?: AcaoPagina[] }; erro?: { mensagem?: string }; erros?: ErroCampo[] }
      if (res.status >= 200 && res.status < 300 && corpo.ok !== false) {
        enviando = false; status.setAttribute('data-tom', 'sucesso'); status.textContent = corpo.sucesso?.mensagem ?? T(def.envio.sucesso?.mensagem) ?? em('Enviado com sucesso.', 'Submitted.'); status.hidden = false
        el.dispatchEvent(new CustomEvent('polaris-enviado', { detail: { resultado: corpo.resultado, sucesso: corpo.sucesso } }))
        if (corpo.sucesso?.limpar) { const m = status.textContent; limpa(); status.setAttribute('data-tom', 'sucesso'); status.textContent = m; status.hidden = false }
        chaveEnvio = chaveAleatoria(); roda(corpo.sucesso?.acoes)
      } else if (res.status === 422 && Array.isArray(corpo.erros)) {
        enviando = false; const porCampo: Record<string, ErroCampo[]> = {}; for (const e of corpo.erros) (porCampo[e.campo] ??= []).push(e)
        const sintetico: ResultadoForm = { ok: false, valores: {}, erros: corpo.erros, porCampo, estado: ultimo?.estado ?? {} }; aplicaEstado(ultimo ?? sintetico); mostraErros(sintetico, new Set(Object.keys(porCampo)))
        if (porCampo._formulario || corpo.erro?.mensagem) { erroGeral.textContent = (porCampo._formulario ?? []).map((e) => e.mensagem).join(' ') || corpo.erro?.mensagem || ''; erroGeral.hidden = false }
        if (def.passos) { const p = Math.min(...corpo.erros.map((e) => noPasso(e.campo.split('.')[0]!))); if (Number.isFinite(p)) irPara(p) }
        foca(corpo.erros); el.dispatchEvent(new CustomEvent('polaris-erro', { detail: { erros: corpo.erros } }))
      } else {
        enviando = false; erroGeral.textContent = corpo.erro?.mensagem ?? T(def.envio.erro?.mensagem) ?? em('Não foi possível enviar agora. Tente de novo em instantes.', 'Could not submit now. Try again shortly.'); erroGeral.hidden = false
        el.dispatchEvent(new CustomEvent('polaris-erro', { detail: { status: res.status } })); roda(def.envio.erro?.acoes)
      }
    } catch {
      enviando = false; erroGeral.textContent = T(def.envio.erro?.mensagem) ?? em('Sem conexão. Tente de novo.', 'No connection. Try again.'); erroGeral.hidden = false
      el.dispatchEvent(new CustomEvent('polaris-erro', { detail: { status: 0 } }))
    } finally { enviando = false; raiz.removeAttribute('aria-busy'); for (const b of botoes.values()) b.disabled = false; if (ultimo) aplicaEstado(ultimo); atualizaBotoesPasso() }
  }
  raiz.addEventListener('submit', (ev) => { ev.preventDefault(); void enviaTudo() })

  // ---- monta ---------------------------------------------------------------------------------------------------------------------------
  el.textContent = ''; el.appendChild(raiz); el.setAttribute('aria-busy', 'false')
  poe(iniciais); atualizaBotoesPasso(); irPara(0)
  return { el, le, poe, valida, envia: enviaTudo, limpa, passo: () => passoAtual }
}

/** monta todos os pontos de montagem ainda não montados dentro de `raiz` */
export async function montaFormularios(raiz: ParentNode = document, opc: OpcoesIlha = {}): Promise<Ilha[]> {
  const out: Ilha[] = []
  for (const el of Array.from(raiz.querySelectorAll<HTMLElement>('[data-polaris-formulario]:not([data-pl-montado])'))) { const i = await montaFormulario(el, opc); if (i) out.push(i) }
  return out
}
