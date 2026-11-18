import { abertosPorBloco, caminhoDeId, igualCaminho, type Caminho, type Inst } from '@polaris/studio'
import type { Editor } from './estado'

type Linha = { inst: Inst; caminho: Caminho; nivel: number; slot?: string }
function linhas(i: Inst, caminho: Caminho, nivel: number, out: Linha[] = []): Linha[] {
  out.push({ inst: i, caminho, nivel })
  for (const [slot, l] of Object.entries(i.slots ?? {})) l.forEach((f, n) => linhas(f, [...caminho, { slot, indice: n }], nivel + 1, out))
  return out
}

export function Arvore({ ed }: { ed: Editor }) {
  const raiz = ed.raiz; if (!raiz) return <p className="vazio">Esta página não tem blocos.</p>
  const abertos = abertosPorBloco(ed.comentarios), sel = ed.selecao, sI = ed.selecionado()
  const slots = sI ? Object.keys(ed.defs[sI.bloco]?.slots ?? {}) : []
  const blocosIds = Object.keys(ed.defs).sort()
  const podeSubir = sel.length > 0 && sel[sel.length - 1]!.indice > 0
  return (
    <div className="arvore">
      <div role="tree" aria-label="Blocos da página" className="arvore-lista">
        {linhas(raiz, [], 0).map((l) => {
          const ativo = igualCaminho(l.caminho, sel), n = l.inst.id ? abertos.get(l.inst.id) : undefined
          return (
            <div key={l.caminho.map((p) => `${p.slot}.${p.indice}`).join('/') || 'raiz'} role="treeitem" aria-selected={ativo} aria-level={l.nivel + 1} className={`no${ativo ? ' ativo' : ''}`} data-testid={`no-${l.inst.id ?? l.inst.bloco}`}
              style={{ paddingLeft: 8 + l.nivel * 14 }} tabIndex={ativo ? 0 : -1} onClick={() => ed.seleciona(l.caminho)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ed.seleciona(l.caminho) } }}>
              <span className="no-tipo">{l.inst.bloco}</span>{l.inst.id && <span className="no-id">#{l.inst.id}</span>}
              {n ? <span className="selo" title={`${n} comentário(s) em aberto`} aria-label={`${n} comentários em aberto`}>💬 {n}</span> : null}
            </div>
          )
        })}
      </div>
      <div className="barra" role="toolbar" aria-label="Ações no bloco selecionado">
        <button disabled={!sel.length} onClick={() => ed.duplica()}>Duplicar</button>
        <button disabled={!sel.length} onClick={() => ed.remove()} className="perigo">Remover</button>
        <button disabled={!podeSubir} onClick={() => ed.desloca(-1)} aria-label="Subir">↑</button>
        <button disabled={!sel.length} onClick={() => ed.desloca(1)} aria-label="Descer">↓</button>
        <button disabled={!podeSubir} onClick={() => ed.recua()} title="Mover para dentro do irmão anterior" aria-label="Recuar">→</button>
        <button disabled={sel.length < 2} onClick={() => ed.avanca()} title="Mover para fora do pai" aria-label="Avançar">←</button>
      </div>
      {sI && slots.length > 0 && <Adicionar ed={ed} slots={slots} blocos={blocosIds} />}
    </div>
  )
}

function Adicionar({ ed, slots, blocos }: { ed: Editor; slots: string[]; blocos: string[] }) {
  const sI = ed.selecionado()!
  return (
    <form className="adicionar" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); ed.adiciona(String(f.get('bloco')), String(f.get('slot'))) }}>
      <label>Adicionar em{' '}<select name="slot" aria-label="Slot de destino">{slots.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label>bloco{' '}<select name="bloco" aria-label="Bloco a adicionar">{blocos.filter((b) => { const a = ed.defs[sI.bloco]?.slots?.[slots[0]!]?.aceita; return !a || a.includes(b) }).map((b) => <option key={b} value={b}>{ed.defs[b]?.titulo && ed.defs[b]!.titulo !== b ? `${ed.defs[b]!.titulo} (${b})` : b}</option>)}</select></label>
      <button type="submit">Adicionar</button>
    </form>
  )
}
export { caminhoDeId }
