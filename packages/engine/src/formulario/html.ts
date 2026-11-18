import { mascaraDoCampo } from './ilha'
import { rotuloPadrao, textoI18n, type CampoSpec } from './validador'

// PRÉVIA ESTÁTICA do formulário (HTML escapado, sem comportamento): mostra rótulos, obrigatórios, ajuda, máscaras (como dica), opções, seções, passos e botões com o mesmo
// desenho da ilha. É o que o Studio mostra num quadro isolado enquanto se edita a definição; o comportamento (máscara, validação) quem testa é a ilha e o painel de teste.

type Texto = string | Record<string, string>
type Ui = { ajuda?: Texto; placeholder?: Texto; opcoes?: Array<{ valor: string | number | boolean; rotulo?: Texto }> | { dados: string }; campos?: Array<CampoSpec & Ui> }
type Def = {
  titulo?: Texto; descricao?: Texto; idioma?: string; campos: Array<CampoSpec & Ui>
  secoes?: Array<{ id: string; titulo?: Texto; campos: string[] }>
  passos?: Array<{ id: string; titulo: Texto; campos?: string[]; secoes?: string[] }>
  acoes?: Array<{ id: string; rotulo: Texto; tipo: string; estilo?: string }>
  envio?: unknown
}
export const escapa = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const INPUT: Record<string, string> = { email: 'email', url: 'url', senha: 'password', telefone: 'tel' }

export function renderizaFormularioHtml(def: Def, o: { idioma?: string; passo?: number } = {}): string {
  const idioma = o.idioma ?? def.idioma ?? 'pt-BR', T = (t: Texto | undefined) => textoI18n(t, idioma, def.idioma)
  const linhas: string[] = []
  let seq = 0
  const campo = (c: CampoSpec & Ui, nivel = 0): string => {
    const id = `pv${++seq}`, rotulo = escapa(T(c.rotulo) ?? rotuloPadrao(c.nome)), obr = c.obrigatorio === true || c.obrigatorioSe !== undefined
    const marca = obr ? ` <span aria-hidden="true">${c.obrigatorio === true ? '*' : '(às vezes obrigatório)'}</span>` : ''
    const masc = c.tipo === 'senha' ? undefined : mascaraDoCampo(c)
    const dica = T(c.placeholder) ?? (masc ? (typeof masc.padrao === 'string' ? masc.padrao : masc.padrao[0]!).replace(/[09]/g, '0').replace(/[Aa*]/g, 'x') : '')
    const ajuda = c.ajuda ? `<small class="pl-ajuda">${escapa(T(c.ajuda))}</small>` : ''
    const cond = c.se !== undefined ? ' data-condicional="true"' : ''
    const abre = `<div class="pl-campo" data-campo="${escapa(c.nome)}" data-tipo="${escapa(c.tipo)}"${cond}>`
    switch (c.tipo) {
      case 'oculto': return `<input type="hidden" name="${escapa(c.nome)}">`
      case 'booleano': return `${abre}<label><input type="checkbox" disabled${c.padrao === true ? ' checked' : ''}> ${rotulo}${marca}</label>${ajuda}</div>`
      case 'textoLongo': return `${abre}<label for="${id}">${rotulo}${marca}</label><textarea id="${id}" rows="4" disabled placeholder="${escapa(dica)}"></textarea>${ajuda}</div>`
      case 'escolha': { const ops = Array.isArray(c.opcoes) ? c.opcoes : []; const dinamica = !Array.isArray(c.opcoes) && !!c.opcoes; return `${abre}<label for="${id}">${rotulo}${marca}</label><select id="${id}" disabled><option>${idioma.startsWith('en') ? 'Select…' : 'Selecione…'}</option>${ops.map((x) => `<option>${escapa(T(x.rotulo) ?? x.valor)}</option>`).join('')}${dinamica ? `<option>(opções de ${escapa((c.opcoes as { dados: string }).dados)})</option>` : ''}</select>${ajuda}</div>` }
      case 'multiescolha': { const ops = Array.isArray(c.opcoes) ? c.opcoes : []; return `${abre}<fieldset><legend>${rotulo}${marca}</legend>${ops.map((x) => `<label><input type="checkbox" disabled> ${escapa(T(x.rotulo) ?? x.valor)}</label>`).join('')}</fieldset>${ajuda}</div>` }
      case 'arquivo': return `${abre}<label for="${id}">${rotulo}${marca}</label><input id="${id}" type="file" disabled>${ajuda}</div>`
      case 'grupo': return `${abre}<fieldset><legend>${rotulo}</legend>${(c.campos ?? []).map((f) => campo(f, nivel + 1)).join('')}</fieldset></div>`
      case 'lista': return `${abre}<fieldset><legend>${rotulo}</legend><div class="pl-item">${(c.campos ?? []).map((f) => campo(f, nivel + 1)).join('')}<button type="button" disabled>${idioma.startsWith('en') ? 'Remove' : 'Remover'}</button></div><button type="button" disabled>${idioma.startsWith('en') ? 'Add' : 'Adicionar'}</button></fieldset></div>`
      default: return `${abre}<label for="${id}">${rotulo}${marca}</label><input id="${id}" type="${INPUT[c.tipo] ?? 'text'}" disabled placeholder="${escapa(dica)}">${ajuda}</div>`
    }
  }
  const porNome = new Map(def.campos.map((c) => [c.nome, c] as const))
  const secaoDe = new Map<string, NonNullable<Def['secoes']>[number]>(); for (const s of def.secoes ?? []) for (const n of s.campos) secaoDe.set(n, s)
  const passoAtual = def.passos ? Math.min(Math.max(0, o.passo ?? 0), def.passos.length - 1) : 0
  const doPasso = (n: string) => !def.passos || (def.passos[passoAtual]!.campos ?? []).includes(n) || (def.passos[passoAtual]!.secoes ?? []).some((sid) => (def.secoes ?? []).find((s) => s.id === sid)?.campos.includes(n))
  const feitas = new Set<string>()
  for (const c of def.campos) {
    if (!doPasso(c.nome)) continue
    const s = secaoDe.get(c.nome)
    if (s) { if (feitas.has(s.id)) continue; feitas.add(s.id); linhas.push(`<fieldset class="pl-secao">${s.titulo ? `<legend>${escapa(T(s.titulo))}</legend>` : ''}${s.campos.filter(doPasso).map((n) => (porNome.get(n) ? campo(porNome.get(n)!) : '')).join('')}</fieldset>`) }
    else linhas.push(campo(c))
  }
  const acoes = def.acoes ?? (def.envio ? [{ id: 'enviar', rotulo: idioma.startsWith('en') ? 'Submit' : 'Enviar', tipo: 'enviar', estilo: 'primario' }] : [])
  const botoes = acoes.filter((a) => !def.passos || (a.tipo === 'voltar' ? passoAtual > 0 : a.tipo === 'avancar' ? passoAtual < def.passos.length - 1 : a.tipo === 'enviar' ? passoAtual === def.passos.length - 1 : true))
    .map((a) => `<button type="button" disabled data-acao="${escapa(a.id)}" data-estilo="${escapa(a.estilo ?? 'secundario')}">${escapa(T(a.rotulo))}</button>`).join('')
  const passos = def.passos ? `<ol class="pl-passos">${def.passos.map((p, i) => `<li${i === passoAtual ? ' aria-current="step"' : ''}>${escapa(T(p.titulo))}</li>`).join('')}</ol>` : ''
  return `<form class="pl-form" aria-label="${escapa(T(def.titulo) ?? 'Formulário')}">${def.titulo ? `<h2>${escapa(T(def.titulo))}</h2>` : ''}${def.descricao ? `<p>${escapa(T(def.descricao))}</p>` : ''}${passos}${linhas.join('')}<div class="pl-acoes">${botoes}</div></form>`
}
