import { useEffect, useMemo, useState } from 'react'
import { Arvore } from './Arvore'
import { Editor, useEditor } from './estado'
import { PainelHistorico } from './Historico'
import { Preview, geraPreview } from './Preview'
import { Propriedades } from './Propriedades'
import { EditorTema } from './Tema'

const AMOSTRA = { kind: 'pagina', id: 'amostra', versao: '1.0.0', spec: { rota: '/amostra', raiz: { bloco: 'layout/pilha', props: { gap: 12 }, slots: { filhos: [
  { bloco: 'texto/titulo', props: { texto: 'Título de exemplo', nivel: 1 } }, { bloco: 'texto/paragrafo', props: { texto: 'Um parágrafo com o texto principal do tema.' } },
  { bloco: 'texto/pequeno', props: { texto: 'Texto suave, menor.' } }, { bloco: 'nav/botao', props: { texto: 'Botão' } },
  { bloco: 'feedback/selo', props: { texto: 'Sucesso', tom: 'sucesso' } }, { bloco: 'feedback/selo', props: { texto: 'Alerta', tom: 'alerta' } }, { bloco: 'feedback/selo', props: { texto: 'Erro', tom: 'erro' } },
] } } } }

type Aba = 'pagina' | 'tema' | 'historico'
export function App({ ed: e0 }: { ed?: Editor }) {
  const [ed] = useState(() => e0 ?? new Editor()); useEditor(ed)
  const [aba, setAba] = useState<Aba>('pagina'); const [criando, setCriando] = useState<'pagina' | 'tema' | undefined>()
  useEffect(() => { void ed.inicia() }, [ed])
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return
      const t = ev.target as HTMLElement | null; const emCampo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
      const k = ev.key.toLowerCase()
      if (k === 's') { ev.preventDefault(); void ed.salva() }
      else if (k === 'z' && !emCampo) { ev.preventDefault(); ev.shiftKey ? ed.refaz() : ed.desfaz() }
      else if (k === 'y' && !emCampo) { ev.preventDefault(); ed.refaz() }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [ed])
  useEffect(() => { const f = (ev: BeforeUnloadEvent) => { if (ed.sujo) { ev.preventDefault() } }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f) }, [ed])
  const abrir = async (v: string) => { const [kind, ...r] = v.split(':'); if (!kind || !r.length) return; await ed.abre(kind, r.join(':')); setAba(kind === 'tema' ? 'tema' : 'pagina') }
  const lista = useMemo(() => {
    const t = new Map(ed.nos.map((n) => [`${n.kind}:${n.id}`, n])), out: Array<{ v: string; rotulo: string }> = []
    for (const kind of ['pagina', 'tema'] as const) for (const id of new Set([...ed.nos.filter((n) => n.kind === kind).map((n) => n.id), ...(ed.base[kind] ?? [])])) out.push({ v: `${kind}:${id}`, rotulo: `${kind === 'pagina' ? 'Página' : 'Tema'} ${id}${t.has(`${kind}:${id}`) ? ' ●' : ' (padrão)'}` })
    return out
  }, [ed.nos, ed.base])
  const a = ed.aberto
  return (
    <div className="app">
      <header className="topo">
        <h1>Polaris Studio</h1>
        <label className="so-leitor" htmlFor="abrir">Abrir nó</label>
        <select id="abrir" value={a ? `${a.kind}:${a.id}` : ''} onChange={(e) => void abrir(e.target.value)} data-testid="abrir"><option value="" disabled>Abrir…</option>{lista.map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}</select>
        <button onClick={() => setCriando('pagina')}>Nova página</button><button onClick={() => setCriando('tema')}>Novo tema</button>
        <span className="espaco" />
        <button onClick={() => ed.desfaz()} disabled={!ed.hist?.podeDesfazer} title={ed.hist?.rotuloDesfazer ? `Desfazer: ${ed.hist.rotuloDesfazer}` : 'Desfazer'}>Desfazer</button>
        <button onClick={() => ed.refaz()} disabled={!ed.hist?.podeRefazer}>Refazer</button>
        <button className="primario" onClick={() => void ed.salva()} disabled={!a || ed.salvando || !ed.sujo} data-testid="salvar">{ed.salvando ? 'Salvando…' : 'Salvar'}</button>
        <span className="estado" data-testid="estado-salvo">{!a ? '' : ed.sujo ? '● alterações não salvas' : a.origem === 'base' ? 'padrão da plataforma' : `salvo (v${a.seqBase})`}</span>
      </header>
      {criando && <NovoNo tipo={criando} fecha={() => setCriando(undefined)} cria={(id, rota) => { ed.novo(criando, id, rota); setAba(criando === 'tema' ? 'tema' : 'pagina'); setCriando(undefined) }} />}
      <div className="aviso-area" role="status" aria-live="polite">{ed.aviso && <div className={`aviso ${ed.aviso.tipo}`} data-testid="aviso"><strong>{ed.aviso.texto}</strong>{ed.aviso.detalhes?.length ? <ul>{ed.aviso.detalhes.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}</div>}</div>
      <nav className="abas" role="tablist" aria-label="Seções">
        {(['pagina', 'tema', 'historico'] as const).map((x) => <button key={x} role="tab" aria-selected={aba === x} onClick={() => setAba(x)} data-testid={`aba-${x}`}>{x === 'pagina' ? 'Página' : x === 'tema' ? 'Tema' : 'Histórico'}</button>)}
      </nav>
      <main>
        {ed.carregando && <p className="vazio">Carregando…</p>}
        {!a && !ed.carregando && <p className="vazio">Abra uma página ou um tema, ou crie um novo.</p>}
        {a && aba === 'pagina' && (a.kind === 'pagina' ? <div className="tres-colunas"><section aria-label="Estrutura"><Arvore ed={ed} /></section><section aria-label="Pré-visualização" className="central"><Preview ed={ed} /></section><section aria-label="Propriedades" className="lateral"><Propriedades ed={ed} /></section></div> : <p className="vazio">Este nó é um {a.kind}: use a aba Tema.</p>)}
        {a && aba === 'tema' && (a.kind === 'tema' ? <div className="duas-colunas"><section aria-label="Tokens"><EditorTema ed={ed} /></section><section aria-label="Pré-visualização do tema" className="central"><PreviewTema ed={ed} /></section></div> : <p className="vazio">Abra um tema.</p>)}
        {aba === 'historico' && <PainelHistorico ed={ed} />}
      </main>
    </div>
  )
}
function PreviewTema({ ed }: { ed: Editor }) {
  const r = useMemo(() => geraPreview(AMOSTRA, [], undefined, ed.no), [ed.no])
  return r.ok ? <iframe className="preview" title="Amostra do tema" sandbox="" srcDoc={r.html} data-testid="preview-tema" /> : <div className="preview-erros" role="alert">{r.erros.join('; ')}</div>
}
function NovoNo({ tipo, cria, fecha }: { tipo: 'pagina' | 'tema'; cria: (id: string, rota: string) => void; fecha: () => void }) {
  const [id, setId] = useState(''), [rota, setRota] = useState('/')
  const idOk = /^[a-z][A-Za-z0-9._/-]{0,127}$/.test(id), rotaOk = tipo === 'tema' || /^\/[A-Za-z0-9_\-/:.]*$/.test(rota)
  return (
    <form className="novo-no" onSubmit={(e) => { e.preventDefault(); if (idOk && rotaOk) cria(id, rota) }} aria-label={`Novo ${tipo}`}>
      <label>Identificador<input value={id} onChange={(e) => setId(e.target.value)} aria-invalid={id !== '' && !idOk} autoFocus /></label>
      {tipo === 'pagina' && <label>Rota<input value={rota} onChange={(e) => setRota(e.target.value)} aria-invalid={!rotaOk} /></label>}
      <button type="submit" disabled={!idOk || !rotaOk}>Criar</button><button type="button" onClick={fecha}>Cancelar</button>
      {id !== '' && !idOk && <small className="erro">minúsculas, números, ponto, _ e -, começando por letra</small>}
    </form>
  )
}
