import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
export { documentoHtml, documentoJs, type Documento } from './documento'

export type PropsIframe = { srcDoc: string; sandbox: string; altura: number; titulo: string; autoAltura: boolean }

/** O iframe. A altura é fixa; no modo js o código pode pedir outra com polaris.altura(n) (validada pelo `source`). */
export function IframeIsolado({ srcDoc, sandbox, altura, titulo, autoAltura }: PropsIframe): ReactNode {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(altura)
  useEffect(() => {
    if (!autoAltura) return
    const aoMensagem = (ev: MessageEvent) => {
      if (ev.source !== ref.current?.contentWindow) return // só o próprio iframe
      const d = ev.data as { polaris?: unknown; n?: unknown } | null
      if (d && d.polaris === 'altura' && typeof d.n === 'number' && Number.isFinite(d.n)) setH(Math.min(4000, Math.max(1, Math.round(d.n))))
    }
    window.addEventListener('message', aoMensagem)
    return () => window.removeEventListener('message', aoMensagem)
  }, [autoAltura])
  return createElement('iframe', { ref, sandbox, srcDoc, title: titulo, referrerPolicy: 'no-referrer', loading: 'lazy', allow: '', style: { border: 0, width: '100%', height: h } })
}
