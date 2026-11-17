import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { jsonSeguro } from '../render/json'
import { escapaHtml } from './html'
import { atributoSandbox, construirCsp, type Permissoes } from './permissoes'
import { sha256Base64 } from './sha256'

// Documento do iframe isolado. Sem allow-same-origin (origem opaca: sem cookies, storage nem acesso ao pai),
// CSP por hash (sem 'unsafe-eval', sem outro script) e permissões só as declaradas.

const CABECALHO = (csp: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapaHtml(csp)}">` +
  '<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0}</style></head><body>'

export type Documento = { srcDoc: string; sandbox: string; csp: string }

/** Modo html: o HTML (já renderizado e escapado) vai no corpo; NENHUM script roda (CSP script-src 'none', sem allow-scripts). */
export function documentoHtml(corpo: string, p: Permissoes): Documento {
  const csp = construirCsp('html', p)
  return { srcDoc: `${CABECALHO(csp)}${corpo}</body></html>`, sandbox: atributoSandbox('html', p), csp }
}

/** Modo js: um único <script> inline (bootstrap + código do autor), autorizado só pelo hash. */
export function documentoJs(fonte: string, props: unknown, p: Permissoes): Documento {
  const bootstrap =
    `"use strict";window.props=Object.freeze(JSON.parse(${JSON.stringify(jsonSeguro(props ?? null))}));` +
    "window.polaris=Object.freeze({altura:function(n){parent.postMessage({polaris:'altura',n:Number(n)},'*')}});"
  // `</script` só pode aparecer em string, regex ou comentário; escapar a barra não muda o significado
  const script = `${bootstrap}\n${fonte}`.replace(/<\/(script)/gi, '<\\/$1')
  const csp = construirCsp('js', p, sha256Base64(script))
  return { srcDoc: `${CABECALHO(csp)}<div id="app"></div><script>${script}</script></body></html>`, sandbox: atributoSandbox('js', p), csp }
}

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
