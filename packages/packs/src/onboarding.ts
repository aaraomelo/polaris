import { fechoDeDependencias, type No, type Registry } from '@polaris/schema'

// Cadastro self-service, parte PURA: dado o registro de packs e o pedido do visitante, devolve um PLANO determinístico (ou os erros). Nada de I/O aqui:
// o plano é testável por inteiro e é o que o provisionador executa. O plano é DADOS (nós e sementes), não código.

export type PedidoCadastro = { alias: string; nome: string; packs: string[]; dono: { email: string; nome: string }; aceiteTermos: boolean }
export type Semente = { servico: string; entidade: string; dados: Record<string, unknown>; guarda?: string }
export type Landing = { titulo: string; subtitulo?: string; chamada?: string; destaques: Array<{ titulo: string; texto?: string }> }
export type Plano = {
  alias: string; nome: string; segmento: string
  /** os packs na ordem em que entram (dependências primeiro; o 1º escolhido define o segmento) */
  packs: string[]
  servicos: string[]; papeis: string[]; papeisDono: string[]; paginas: string[]; tema: string | null
  sementes: Semente[]
  landing: Landing | null
  /** o nó `tenant` que o cadastro cria */
  tenant: No
  dono: { email: string; nome: string }
}
export type SegmentoPublico = { id: string; nome: string; descricao: string; segmento: string; padrao: boolean }

type SpecPack = { nome: string; descricao?: string; segmento: string; padrao?: boolean; ordem?: number; oculto?: boolean; depende?: string[]; conflita?: string[]; inclui: { servicos?: string[]; papeis?: string[]; paginas?: string[]; tema?: string }; papeisDono?: string[]; sementes?: Semente[]; landing?: Omit<Landing, 'destaques'> & { destaques?: Landing['destaques'] } }

/** subdomínios que a plataforma usa ou que enganam o visitante (phishing por nome): nunca viram tenant */
export const ALIAS_RESERVADOS = new Set(['www', 'api', 'app', 'admin', 'administrador', 'root', 'suporte', 'support', 'ajuda', 'help', 'status', 'mail', 'email', 'smtp', 'ftp', 'login', 'entrar', 'auth', 'oauth', 'sso', 'conta', 'account', 'billing', 'pagamento', 'pagamentos', 'cobranca', 'seguranca', 'security', 'polaris', 'plataforma', 'platform', 'gateway', 'cdn', 'static', 'assets', 'docs', 'blog', 'loja', 'dev', 'staging', 'test', 'teste', 'demo', 'metrics', 'grafana', 'localhost'])
const ALIAS = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/ // 3 a 30; sem hífen nas pontas (vira subdomínio)
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const CONTROLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]') // controle e override bidirecional (spoofing de nome)

export function validaAlias(alias: unknown): { ok: true; alias: string } | { ok: false; motivo: 'formato' | 'reservado' } {
  if (typeof alias !== 'string') return { ok: false, motivo: 'formato' }
  const a = alias.trim().toLowerCase()
  if (!ALIAS.test(a) || a.includes('--')) return { ok: false, motivo: 'formato' } // `--` é reservado em punycode (xn--): evita homógrafos
  if (ALIAS_RESERVADOS.has(a) || a.startsWith('xn-')) return { ok: false, motivo: 'reservado' }
  return { ok: true, alias: a }
}

export function segmentosDisponiveis(reg: Registry): SegmentoPublico[] {
  return reg.ids('pack').flatMap((id) => { const n = reg.resolve('pack', id); return n ? [{ id, spec: n.no.spec as SpecPack }] : [] })
    .filter((p) => !p.spec.oculto).sort((a, b) => (a.spec.ordem ?? 0) - (b.spec.ordem ?? 0) || (a.id < b.id ? -1 : 1))
    .map((p) => ({ id: p.id, nome: p.spec.nome, descricao: p.spec.descricao ?? '', segmento: p.spec.segmento, padrao: !!p.spec.padrao }))
}

const sub = (s: string, nome: string) => s.replace(/\{\{nome\}\}/g, () => nome)

export function planoDeCadastro(reg: Registry, entrada: PedidoCadastro): { ok: true; plano: Plano } | { ok: false; erros: string[] } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, erros: ['pedido inválido'] }
  const pedido = entrada
  const erros: string[] = []
  const a = validaAlias(pedido.alias); if (!a.ok) erros.push(a.motivo === 'reservado' ? 'alias reservado' : 'alias inválido (3 a 30 letras minúsculas, números e hífen, sem hífen nas pontas nem duplo)')
  const nome = typeof pedido.nome === 'string' ? pedido.nome.trim().replace(/\s+/g, ' ') : ''
  if (nome.length < 2 || nome.length > 80 || CONTROLE.test(nome)) erros.push('nome do negócio inválido (2 a 80 caracteres, sem caracteres de controle)')
  const dono = pedido.dono && typeof pedido.dono === 'object' ? pedido.dono : ({} as PedidoCadastro['dono'])
  const dn = typeof dono.nome === 'string' ? dono.nome.trim() : '', de = typeof dono.email === 'string' ? dono.email.trim().toLowerCase() : ''
  if (dn.length < 2 || dn.length > 80 || CONTROLE.test(dn)) erros.push('nome do responsável inválido')
  if (de.length > 254 || !EMAIL.test(de)) erros.push('e-mail do responsável inválido')
  if (pedido.aceiteTermos !== true) erros.push('é preciso aceitar os termos de uso')
  const escolhidos = Array.isArray(pedido.packs) ? [...new Set(pedido.packs)] : []
  if (!escolhidos.length || escolhidos.length > 4) erros.push('escolha de 1 a 4 segmentos')
  const publicos = new Set(segmentosDisponiveis(reg).map((s) => s.id))
  for (const p of escolhidos) if (typeof p !== 'string' || !publicos.has(p)) erros.push(`segmento inexistente ou indisponível: ${String(p).slice(0, 40)}`)
  if (erros.length) return { ok: false, erros }

  // o fecho: dependências antes, na ordem de escolha; sem repetir
  const ordem: string[] = []
  for (const p of escolhidos) {
    const f = fechoDeDependencias(reg, p); if ('ciclo' in f) return { ok: false, erros: [`dependência circular: ${f.ciclo.join(' → ')}`] }
    for (const x of f.ordem) if (!ordem.includes(x)) ordem.push(x)
  }
  const specs = new Map(ordem.map((id) => [id, reg.resolve('pack', id)!.no.spec as SpecPack]))
  for (const [id, s] of specs) for (const c of s.conflita ?? []) if (specs.has(c)) erros.push(`os segmentos '${id}' e '${c}' não podem ser combinados`)
  if (erros.length) return { ok: false, erros }

  const uniao = <T>(f: (s: SpecPack) => T[] | undefined): T[] => [...new Set(ordem.flatMap((id) => f(specs.get(id)!) ?? []))]
  const servicos = uniao((s) => s.inclui.servicos), papeis = uniao((s) => s.inclui.papeis), papeisDono = uniao((s) => s.papeisDono), paginas = uniao((s) => s.inclui.paginas)
  const tema = ordem.map((id) => specs.get(id)!.inclui.tema).find((t) => t) ?? null
  // sementes na ordem dos packs; a MESMA semente pedida por dois packs (depósito principal) vale uma vez
  const vistas = new Set<string>(), sementes: Semente[] = []
  for (const id of ordem) for (const s of specs.get(id)!.sementes ?? []) { const k = JSON.stringify([s.servico, s.entidade, s.dados]); if (!vistas.has(k)) { vistas.add(k); sementes.push(structuredClone(s)) } }
  const principal = specs.get(escolhidos[0]!)!
  const l = principal.landing
  const landing: Landing | null = l ? { titulo: sub(l.titulo, nome), ...(l.subtitulo ? { subtitulo: sub(l.subtitulo, nome) } : {}), ...(l.chamada ? { chamada: l.chamada } : {}), destaques: escolhidos.flatMap((id) => specs.get(id)!.landing?.destaques ?? []).slice(0, 8).map((d) => ({ titulo: sub(d.titulo, nome), ...(d.texto ? { texto: sub(d.texto, nome) } : {}) })) } : null
  const alias = (a as { alias: string }).alias
  const tenant = { kind: 'tenant', id: alias, versao: '1.0.0', estatuto: 'publicado', spec: { alias, nome, segmento: principal.segmento, modulos: servicos, ...(tema ? { tema } : {}), ...(paginas.length ? { paginas } : {}) } } as unknown as No
  return { ok: true, plano: { alias, nome, segmento: principal.segmento, packs: ordem, servicos, papeis, papeisDono, paginas, tema, sementes, landing, tenant, dono: { email: de, nome: dn } } }
}
