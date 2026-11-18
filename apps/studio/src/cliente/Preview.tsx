import { useEffect, useMemo } from 'react'
import { geraPreview } from '../preview'
import type { Editor } from './estado'

export { geraPreview }
export function Preview({ ed, tema }: { ed: Editor; tema?: any }) {
  const sel = ed.selecionado(), id = sel?.id
  const r = useMemo(() => (ed.no?.kind === 'pagina' ? geraPreview(ed.no, ed.blocosDoTenant, id, tema) : { ok: false as const, erros: ['Abra uma página para ver o preview.'] }), [ed.no, ed.blocosDoTenant, id, tema])
  const erros = r.ok ? [] : ed.no?.kind === 'pagina' ? r.erros : []
  useEffect(() => { ed.defineErrosCompilacao(erros) }, [ed, erros.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!r.ok) return <div className="preview-erros" role="alert" data-testid="preview-erros"><strong>O preview não compila</strong><ul>{r.erros.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
  return <iframe className="preview" title="Pré-visualização da página" sandbox="" srcDoc={r.html} data-testid="preview" />
}
