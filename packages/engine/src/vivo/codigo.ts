import { calculaCodigo } from '../codigo/calcula'
import { hashDoHtml, saidaParaDom, saidaParaHtml } from '../codigo/emite'
import { SessaoCodigo } from '../codigo/sessao'
import { cruza } from './dep'
import type { ArgsBlocoCodigo, ConstroiCodigo, CtrlPublico } from './monta'

// ---------------------------------------------------------------------------
// PLUGIN de blocos de código para o runtime vivo (sem React). O núcleo só reserva a unidade entre marcadores `<!--c:HASH-->…<!--/c-->`;
// o conteúdo é daqui:
//   - HIDRATAÇÃO: o servidor já executou o código (sandbox) e escreveu o resultado; o cliente CONFIA no HTML (mesmas props, mesmo `agora`) e
//     não executa nada. Páginas cujos blocos têm props constantes nunca carregam o sandbox no cliente.
//   - PROPS QUE MUDAM: o cliente recalcula com o MESMO `calculaCodigo` do servidor (mesma validação, mesma allowlist), troca só o conteúdo
//     da unidade, e só se o HTML resultante mudou (hash).
//   - Fail-closed: sem sandbox no cliente, ou qualquer falha, o conteúdo vira vazio e a falha é reportada; a página segue.
// O DOM é construído com createElement/setAttribute a partir da UI JÁ sanitizada: nunca innerHTML.
// ---------------------------------------------------------------------------

export const constroiCodigo: ConstroiCodigo = (a: ArgsBlocoCodigo): CtrlPublico | void => {
  const { ini, fim } = a.unidade
  const doc = ini.ownerDocument
  const sessao = a.codigo ? new SessaoCodigo(a.codigo) : undefined
  let propsAtuais = a.props()
  let chaveProps = JSON.stringify(propsAtuais)
  let hash: string | null = a.unidade.hash
  let removeAltura: (() => void) | null = null

  const limpa = () => { removeAltura?.(); removeAltura = null; while (ini.nextSibling && ini.nextSibling !== fim) ini.parentNode!.removeChild(ini.nextSibling) }

  /** liga o ajuste de altura do iframe (modo js): só aceita mensagem do PRÓPRIO iframe, valida o número e limita a 1–4000 px */
  const ligaAltura = () => {
    if (!(a.def.modo === 'iframe' && a.def.linguagem === 'js')) return
    let f: Node | null = ini.nextSibling
    while (f && f !== fim && f.nodeName !== 'IFRAME') f = f.nextSibling
    if (!f || f === fim) return
    const el = f as HTMLIFrameElement
    const aoMensagem = (ev: MessageEvent) => {
      if (ev.source !== el.contentWindow) return
      const d = ev.data as { polaris?: unknown; n?: unknown } | null
      if (d && d.polaris === 'altura' && typeof d.n === 'number' && Number.isFinite(d.n)) el.style.height = `${Math.min(4000, Math.max(1, Math.round(d.n)))}px`
    }
    const w = doc.defaultView
    w?.addEventListener('message', aoMensagem)
    removeAltura = () => w?.removeEventListener('message', aoMensagem)
  }

  /** recalcula e troca o conteúdo da unidade (só se o HTML mudou) */
  const pinta = () => {
    sessao?.novaPassagem()
    const saida = calculaCodigo({
      def: a.def, props: propsAtuais, escopo: { props: propsAtuais, tenant: a.esc.tenant }, caminho: a.no.caminho, sessao, relata: a.relata, funcoes: a.funcoes,
      ...(typeof a.esc.idioma === 'string' && a.esc.idioma ? { idioma: a.esc.idioma } : {}),
    })
    const h = hashDoHtml(saidaParaHtml(saida))
    if (h === hash) return
    limpa()
    for (const n of saidaParaDom(saida, doc)) fim.parentNode!.insertBefore(n, fim)
    ini.data = `c:${h}`
    hash = h
    ligaAltura()
  }

  if (!a.adotou) pinta() // montagem no cliente, sem HTML do servidor: executa (precisa do sandbox; sem ele, fail-closed)
  else ligaAltura()
  if (a.estatico) return // props constantes: nada a atualizar, nada a executar no cliente

  return {
    usa: a.deps, morto: false,
    atualiza(m) {
      if (!cruza(a.deps, m)) return
      const np = a.props()
      const k = JSON.stringify(np)
      if (k === chaveProps) return
      propsAtuais = np; chaveProps = k
      pinta()
    },
    destroi() { this.morto = true; removeAltura?.(); removeAltura = null },
  }
}
