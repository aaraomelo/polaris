import { useId, useState } from 'react'
import { auditaContraste, defineToken, efetivos, ehCor, GRUPOS, removeModo, removeToken, validaToken, type Grupo, type Tema } from '@polaris/studio'
import type { Editor } from './estado'

export function EditorTema({ ed }: { ed: Editor }) {
  const [modo, setModo] = useState<string | undefined>(undefined)
  const tema = ed.no?.kind === 'tema' ? (ed.no.spec as Tema) : undefined
  if (!tema) return <p className="vazio">Abra ou crie um tema.</p>
  const modos = Object.keys(tema.modos ?? {}), ef = efetivos(tema, modo), avisos = auditaContraste(tema)
  const aplica = (r: ReturnType<typeof defineToken>, rotulo: string, grupo?: string) => { if (r.ok) ed.edita({ ...ed.no, spec: r.tema }, rotulo, grupo) }
  return (
    <div className="tema">
      <div className="barra-modo" role="tablist" aria-label="Modo do tema">
        <button role="tab" aria-selected={modo === undefined} onClick={() => setModo(undefined)}>Base</button>
        {modos.map((m) => <button key={m} role="tab" aria-selected={modo === m} onClick={() => setModo(m)}>{m}</button>)}
        <NovoModo existentes={modos} aoCriar={(m) => { aplica(defineToken(tema, 'cor', 'fundo', ef.cor?.fundo ?? '#ffffff', m), `criar modo ${m}`); setModo(m) }} />
        {modo !== undefined && <button className="perigo" onClick={() => { ed.edita({ ...ed.no, spec: removeModo(tema, modo) }, `remover modo ${modo}`); setModo(undefined) }}>Remover modo</button>}
      </div>
      {avisos.length > 0 && <ul className="erros" role="alert" data-testid="avisos-contraste">{avisos.map((a, i) => <li key={i}>Contraste baixo em <strong>{a.par}</strong> ({a.modo}): {a.contraste}:1, o mínimo é {a.minimo}:1</li>)}</ul>}
      {GRUPOS.map((g) => <GrupoTokens key={g} grupo={g} valores={(ef as Record<string, Record<string, unknown>>)[g] ?? {}} sobrescritos={modo === undefined ? undefined : new Set(Object.keys(((tema.modos?.[modo] ?? {}) as Record<string, Record<string, unknown>>)[g] ?? {}))}
        aoDefinir={(n, v) => aplica(defineToken(tema, g, n, v, modo), `token ${g}.${n}`, `token:${modo ?? ''}:${g}.${n}`)} aoRemover={(n) => ed.edita({ ...ed.no, spec: removeToken(tema, g, n, modo) }, `remover token ${n}`)} />)}
    </div>
  )
}
function NovoModo({ existentes, aoCriar }: { existentes: string[]; aoCriar: (m: string) => void }) {
  const [t, setT] = useState(''), id = useId(), invalido = t !== '' && (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(t) || existentes.includes(t))
  return <form onSubmit={(e) => { e.preventDefault(); if (t && !invalido) { aoCriar(t); setT('') } }}><label htmlFor={id} className="so-leitor">Novo modo</label><input id={id} placeholder="novo modo (ex.: escuro)" value={t} onChange={(e) => setT(e.target.value)} aria-invalid={invalido} /><button type="submit" disabled={!t || invalido}>Criar modo</button></form>
}
function GrupoTokens({ grupo, valores, sobrescritos, aoDefinir, aoRemover }: { grupo: Grupo; valores: Record<string, unknown>; sobrescritos: Set<string> | undefined; aoDefinir: (n: string, v: unknown) => void; aoRemover: (n: string) => void }) {
  const [novo, setNovo] = useState(''), [valorNovo, setValorNovo] = useState('')
  const erroNovo = novo ? validaToken(grupo, novo, grupo === 'cor' ? valorNovo : grupo === 'tipografia' ? {} : Number(valorNovo.replace(',', '.'))) : undefined
  return (
    <fieldset className="grupo" data-testid={`grupo-${grupo}`}>
      <legend>{grupo}</legend>
      {Object.entries(valores).map(([n, v]) => <LinhaToken key={n} grupo={grupo} nome={n} valor={v} herdado={sobrescritos !== undefined && !sobrescritos.has(n)} aoDefinir={(x) => aoDefinir(n, x)} aoRemover={() => aoRemover(n)} />)}
      {grupo !== 'tipografia' && (
        <form className="novo-token" onSubmit={(e) => { e.preventDefault(); if (!erroNovo && novo) { aoDefinir(novo, grupo === 'cor' ? valorNovo : (/^-?\d+([.,]\d+)?$/.test(valorNovo.trim()) ? Number(valorNovo.replace(',', '.')) : valorNovo.trim())); setNovo(''); setValorNovo('') } }}>
          <input aria-label={`Nome do novo token de ${grupo}`} placeholder="nome" value={novo} onChange={(e) => setNovo(e.target.value)} /><input aria-label={`Valor do novo token de ${grupo}`} placeholder={grupo === 'cor' ? '#rrggbb' : '8 ou 0.5rem'} value={valorNovo} onChange={(e) => setValorNovo(e.target.value)} />
          <button type="submit" disabled={!novo || !valorNovo || erroNovo !== undefined}>Adicionar</button>{novo && valorNovo && erroNovo && <small className="erro" role="alert">{erroNovo}</small>}
        </form>)}
    </fieldset>
  )
}
function LinhaToken({ grupo, nome, valor, herdado, aoDefinir, aoRemover }: { grupo: Grupo; nome: string; valor: unknown; herdado: boolean; aoDefinir: (v: unknown) => void; aoRemover: () => void }) {
  const id = useId(), texto = typeof valor === 'string' || typeof valor === 'number' ? String(valor) : JSON.stringify(valor)
  const [rascunho, setRascunho] = useState<string | undefined>(), [erro, setErro] = useState<string | undefined>()
  const mostrado = rascunho ?? texto
  const muda = (t: string) => {
    setRascunho(t); if (grupo === 'tipografia') { try { aoDefinir(JSON.parse(t)); setErro(undefined) } catch { setErro('JSON inválido') } return }
    const v: unknown = grupo === 'cor' ? t : /^-?\d+([.,]\d+)?$/.test(t.trim()) ? Number(t.replace(',', '.')) : t.trim()
    const e = validaToken(grupo, nome, v); if (e) setErro(e); else { setErro(undefined); aoDefinir(v) }
  }
  return (
    <div className={`token${herdado ? ' herdado' : ''}`}>
      <label htmlFor={id}>{nome}{herdado ? ' (herdado)' : ''}</label>
      {grupo === 'cor' && typeof valor === 'string' && /^#[0-9a-f]{6}$/i.test(valor) && <input type="color" aria-label={`Seletor de cor de ${nome}`} value={valor} onChange={(e) => muda(e.target.value)} />}
      <input id={id} value={mostrado} onChange={(e) => muda(e.target.value)} onBlur={() => { setRascunho(undefined); setErro(undefined) }} aria-invalid={erro !== undefined} />
      {grupo === 'cor' && <span className="amostra" style={{ background: ehCor(valor) ? String(valor) : 'transparent' }} aria-hidden="true" />}
      {!herdado && <button type="button" className="mini perigo" onClick={aoRemover} aria-label={`Remover ${nome}`}>✕</button>}
      {erro && <small className="erro" role="alert">{erro}</small>}
    </div>
  )
}
