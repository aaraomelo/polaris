import { useId, useState } from 'react'
import { camposDe, converte, ehBinding, leValor, validaProps, type Campo } from '@polaris/studio'
import { api } from './api'
import type { Editor } from './estado'
import { Comentarios } from './Historico'

/** Formulário GERADO do JSON Schema do bloco. Texto digitado que não converte (número inválido…) fica no campo com a mensagem e NÃO altera o rascunho. */
export function Propriedades({ ed }: { ed: Editor }) {
  const sel = ed.selecionado(); if (!sel) return <p className="vazio">Selecione um bloco na árvore.</p>
  const def = ed.defs[sel.bloco], campos = def?.props ? camposDe(def.props) : []
  const erros = def?.props ? validaProps(def.props, sel.props) : []
  const chave = ed.selecao.map((p) => `${p.slot}.${p.indice}`).join('/')
  return (
    <div className="props" key={chave}>
      <h2>{def?.titulo ?? sel.bloco} <small>{sel.bloco}</small></h2>
      {def?.descricao && <p className="desc">{def.descricao}</p>}
      {!def && <p className="erro" role="alert">Este bloco não existe no catálogo do tenant.</p>}
      <Texto id="id" rotulo="Identificador" valor={sel.id ?? ''} aoMudar={(v) => ed.setId(v)} ajuda="Opcional; usado para destacar no preview e ancorar comentários." />
      <Texto id="se" rotulo="Exibir se (expressão)" valor={sel.se ?? ''} aoMudar={(v) => ed.setSe(v)} ajuda="Ex.: estado.logado. Vazio = sempre." />
      {campos.map((c) => <CampoForm key={c.caminho.join('.')} c={c} ed={ed} props={sel.props} />)}
      {erros.length > 0 && <ul className="erros" role="alert" data-testid="erros-props">{erros.map((e, i) => <li key={i}>{e.caminho.join('.') || 'props'}: {e.mensagem}</li>)}</ul>}
      {def?.slots && Object.keys(def.slots).length > 0 && <p className="desc">Slots: {Object.keys(def.slots).join(', ')}</p>}
      {sel.id ? <Comentarios ed={ed} ancora={sel.id} titulo="Comentários neste bloco" /> : <p className="desc">Dê um identificador ao bloco para comentar nele.</p>}
    </div>
  )
}

function CampoForm({ c, ed, props }: { c: Campo; ed: Editor; props: Record<string, unknown> | undefined }) {
  const valor = leValor(props, c.caminho)
  if (c.tipo === 'objeto') return <fieldset className="grupo"><legend>{c.rotulo}</legend>{(c.filhos ?? []).map((f) => <CampoForm key={f.caminho.join('.')} c={f} ed={ed} props={props} />)}</fieldset>
  if (c.tipo === 'booleano') return <Caixa c={c} valor={valor} ed={ed} />
  return <Entrada c={c} valor={valor} ed={ed} />
}
function Caixa({ c, valor, ed }: { c: Campo; valor: unknown; ed: Editor }) {
  const id = useId(); const binding = ehBinding(valor)
  return (
    <div className="campo">
      {binding ? <Entrada c={{ ...c, tipo: 'texto' }} valor={valor} ed={ed} /> : <label htmlFor={id}><input id={id} type="checkbox" checked={valor === true} onChange={(e) => { const r = converte(c, e.target.checked); if (r.ok) ed.setProp(c.caminho, r.valor) }} /> {c.rotulo}{c.obrigatorio ? ' *' : ''}</label>}
      {!binding && <button type="button" className="mini" onClick={() => ed.setProp(c.caminho, '{expressao}')} title="Ligar a uma expressão">{'{ }'}</button>}
    </div>
  )
}
function Entrada({ c, valor, ed }: { c: Campo; valor: unknown; ed: Editor }) {
  const id = useId(), mostrado = valor === undefined ? '' : typeof valor === 'string' ? valor : typeof valor === 'object' ? JSON.stringify(valor) : String(valor)
  const [rascunho, setRascunho] = useState<string | undefined>(undefined), [erro, setErro] = useState<string | undefined>(undefined)
  const texto = rascunho ?? mostrado
  const muda = (t: string) => { setRascunho(t); const r = converte(c, t); if (r.ok) { setErro(undefined); ed.setProp(c.caminho, r.valor) } else { setErro(r.erro) } }
  const sai = () => { setRascunho(undefined); setErro(undefined) } // ao sair do campo, volta a mostrar o valor guardado (o que foi digitado e era inválido é descartado)
  const rotulo = `${c.rotulo}${c.obrigatorio ? ' *' : ''}`
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {c.tipo === 'escolha' ? (
        <select id={id} value={texto} onChange={(e) => muda(e.target.value)} onBlur={sai}><option value="">{c.padrao !== undefined ? `(padrão: ${String(c.padrao)})` : '—'}</option>{(c.opcoes ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select>
      ) : c.tipo === 'json' || c.tipo === 'lista' ? (
        <textarea id={id} rows={3} value={texto} spellCheck={false} onChange={(e) => muda(e.target.value)} onBlur={sai} />
      ) : <input id={id} type="text" inputMode={c.tipo === 'numero' || c.tipo === 'inteiro' ? 'decimal' : 'text'} value={texto} onChange={(e) => muda(e.target.value)} onBlur={sai} aria-invalid={erro !== undefined} aria-describedby={erro ? `${id}-e` : undefined} />}
      {c.descricao && <small className="ajuda">{c.descricao}</small>}
      {erro && <small className="erro" id={`${id}-e`} role="alert">{erro}</small>}
    </div>
  )
}
function Texto({ id, rotulo, valor, aoMudar, ajuda }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; ajuda?: string }) {
  const uid = useId()
  return <div className="campo"><label htmlFor={uid + id}>{rotulo}</label><input id={uid + id} type="text" value={valor} onChange={(e) => aoMudar(e.target.value)} />{ajuda && <small className="ajuda">{ajuda}</small>}</div>
}
export { api }
