import { useEffect, useState } from 'react'
import { fios, situacao, type Comentario, type Diff, type MudancaBloco } from '@polaris/studio'
import { api, ErroApi, type Meta } from './api'
import type { Editor } from './estado'

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const val = (v: unknown): string => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t === undefined ? '∅' : t.length > 80 ? `${t.slice(0, 79)}…` : t }
const ROTULO: Record<MudancaBloco['tipo'], string> = { adicionado: 'Adicionado', removido: 'Removido', movido: 'Movido', reordenado: 'Reordenado', alterado: 'Alterado' }

export function PainelHistorico({ ed }: { ed: Editor }) {
  const [de, setDe] = useState<string>(''), [para, setPara] = useState<string>(''), [diff, setDiff] = useState<Diff | undefined>(), [erro, setErro] = useState<string | undefined>(), [carregando, setCarregando] = useState(false)
  const a = ed.aberto
  useEffect(() => { setDiff(undefined); setErro(undefined); setDe(''); setPara('') }, [a?.kind, a?.id])
  if (!a) return <p className="vazio">Abra um nó para ver o histórico.</p>
  if (a.origem === 'novo') return <p className="vazio">Este nó ainda não foi salvo.</p>
  const compara = async () => {
    if (!de || !para) return; setCarregando(true); setErro(undefined)
    try { setDiff(await api.diff(a.kind, a.id, de, para)) } catch (e) { setDiff(undefined); setErro(e instanceof ErroApi ? e.message : String(e)) }
    setCarregando(false)
  }
  const restaura = async (v: Meta) => { try { const r = await api.versao(a.kind, a.id, v.seq); ed.restauraVersao(r.no, v.seq) } catch (e) { setErro(String(e)) } }
  return (
    <div className="historico">
      <h2>Versões de {a.kind} <code>{a.id}</code></h2>
      {ed.versoes.length === 0 ? <p className="vazio">Sem versões do tenant: o nó é o padrão da plataforma.</p> : (
        <table className="versoes" data-testid="versoes">
          <thead><tr><th>Versão</th><th>Quem</th><th>Quando</th><th>Nota</th><th><span className="so-leitor">Comparar</span></th><th></th></tr></thead>
          <tbody>{ed.versoes.map((v) => (
            <tr key={v.seq} className={v.removido ? 'removida' : ''}>
              <td>v{v.seq}{v.removido ? ' (restaurou o padrão)' : ''}</td><td>{v.autor}</td><td>{quando(v.criadoEm)}</td><td>{v.nota ?? ''}</td>
              <td><label>de <input type="radio" name="de" value={v.seq} checked={de === String(v.seq)} onChange={() => setDe(String(v.seq))} aria-label={`Comparar a partir da v${v.seq}`} /></label> <label>para <input type="radio" name="para" value={v.seq} checked={para === String(v.seq)} onChange={() => setPara(String(v.seq))} aria-label={`Comparar até a v${v.seq}`} /></label></td>
              <td>{!v.removido && <button onClick={() => restaura(v)}>Restaurar no editor</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      <div className="acoes"><button disabled={!de || !para || carregando} onClick={compara}>Comparar versões</button>
        {a.origem === 'tenant' && ed.versoes.length > 0 && <button onClick={() => { setDe('base'); setPara(String(ed.versoes[0]!.seq)); setTimeout(compara, 0) }}>Comparar com o padrão</button>}</div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {diff && <VerDiff diff={diff} />}
      <Comentarios ed={ed} titulo="Comentários do nó" />
    </div>
  )
}

export function VerDiff({ diff }: { diff: Diff }) {
  if (diff.igual) return <p className="vazio" data-testid="diff-igual">Sem diferenças.</p>
  const r = diff.resumo
  return (
    <div className="diff" data-testid="diff">
      <p className="resumo-diff">{[r.adicionados && `${r.adicionados} adicionado(s)`, r.removidos && `${r.removidos} removido(s)`, r.movidos && `${r.movidos} movido(s)`, r.reordenados && `${r.reordenados} reordenado(s)`, r.alterados && `${r.alterados} alterado(s)`, diff.campos.length && `${diff.campos.length} campo(s) do nó`].filter(Boolean).join(' · ')}</p>
      <ul>
        {diff.blocos.map((b, i) => (
          <li key={i} className={`mud ${b.tipo}`}><strong>{ROTULO[b.tipo]}</strong> <code>{b.rotulo}</code>
            {b.descendentes ? <span> (com {b.descendentes} bloco(s) dentro)</span> : null}
            {b.tipo === 'movido' && <span> de <code>{b.de || 'raiz'}</code> para <code>{b.para || 'raiz'}</code></span>}
            {b.campos && <ul>{b.campos.map((c, j) => <li key={j}><code>{c.caminho.join('.')}</code>{' '}{c.tipo === 'alterado' ? <>{<del>{val(c.antes)}</del>} → <ins>{val(c.depois)}</ins></> : c.tipo === 'adicionado' ? <>adicionado: <ins>{val(c.depois)}</ins></> : <>removido: <del>{val(c.antes)}</del></>}</li>)}</ul>}
          </li>))}
        {diff.campos.map((c, i) => <li key={`c${i}`} className={`mud ${c.tipo}`}><strong>{c.tipo === 'alterado' ? 'Alterado' : c.tipo === 'adicionado' ? 'Adicionado' : 'Removido'}</strong> <code>{c.caminho.join('.')}</code>{' '}{c.tipo === 'alterado' ? <><del>{val(c.antes)}</del> → <ins>{val(c.depois)}</ins></> : c.tipo === 'adicionado' ? <ins>{val(c.depois)}</ins> : <del>{val(c.antes)}</del>}</li>)}
      </ul>
    </div>
  )
}

/** Comentários do nó (ou só de um bloco, se `ancora`). Fios com respostas e resolução; os de um bloco que já não existe aparecem como "órfãos". */
export function Comentarios({ ed, ancora, titulo }: { ed: Editor; ancora?: string; titulo: string }) {
  const [texto, setTexto] = useState(''), [resp, setResp] = useState<string | undefined>()
  const lista = ancora === undefined ? ed.comentarios : ed.comentarios.filter((c) => c.ancora === ancora || (c.respondeA && ed.comentarios.find((r) => r.id === c.respondeA)?.ancora === ancora))
  const todos = fios(lista), a = ed.aberto
  const envia = async () => { if (!texto.trim()) return; await ed.comenta(texto, ancora, resp); setTexto(''); setResp(undefined) }
  return (
    <section className="comentarios" aria-label={titulo} data-testid="comentarios">
      <h3>{titulo}</h3>
      {a?.origem === 'novo' ? <p className="vazio">Salve o nó para comentar.</p> : <>
        {todos.length === 0 && <p className="vazio">Nenhum comentário.</p>}
        {todos.map((f) => <Fio key={f.raiz.id} f={f} ed={ed} responde={setResp} />)}
        <div className="novo-comentario">
          {resp && <p className="desc">Respondendo… <button type="button" className="mini" onClick={() => setResp(undefined)}>cancelar</button></p>}
          <label>Comentário<textarea rows={2} value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)} /></label>
          <button disabled={!texto.trim()} onClick={envia}>Comentar</button>
        </div></>}
    </section>
  )
}
function Fio({ f, ed, responde }: { f: ReturnType<typeof fios>[number]; ed: Editor; responde: (id: string) => void }) {
  const s = situacao(f.raiz, ed.raiz); const todos: Comentario[] = [f.raiz, ...f.respostas]
  return (
    <article className={`fio${f.resolvido ? ' resolvido' : ''}`} data-testid="fio">
      <header>{f.raiz.ancora && <code>#{f.raiz.ancora}</code>}{s === 'orfao' && <span className="orfao" title="O bloco comentado não existe mais nesta página"> órfão</span>}{f.resolvido && <span className="ok"> resolvido</span>}</header>
      {todos.map((c) => <p key={c.id} className="comentario"><strong>{c.autor}</strong> <time dateTime={c.criadoEm}>{quando(c.criadoEm)}</time><br />{c.texto}</p>)}
      <footer><button className="mini" onClick={() => responde(f.raiz.id)}>Responder</button> <button className="mini" onClick={() => ed.resolve(f.raiz.id, !f.resolvido)}>{f.resolvido ? 'Reabrir' : 'Resolver'}</button></footer>
    </article>
  )
}
