import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

// SENHAS: scrypt (Node, sem dependência), sal por usuário, parâmetros dentro do próprio hash (dá para subir o custo sem invalidar ninguém: quem entra com um hash velho é reprocessado),
// comparação em tempo constante, e um hash FALSO para que "e-mail que não existe" gaste o mesmo tempo que "senha errada". A senha nunca é registrada em log nem devolvida.

export type CustoSenha = { N: number; r: number; p: number }
export const CUSTO_PADRAO: CustoSenha = { N: 2 ** 15, r: 8, p: 1 }
export const SENHA_MIN = 10, SENHA_MAX = 128
const TAM_CHAVE = 64

const deriva = (senha: string, sal: Buffer, c: CustoSenha): Promise<Buffer> => new Promise((ok, falha) => scryptCb(senha.normalize('NFKC'), sal, TAM_CHAVE, { N: c.N, r: c.r, p: c.p, maxmem: 128 * c.N * c.r * 2 + 1024 * 1024 }, (e, k) => (e ? falha(e) : ok(k))))
const custoValido = (c: CustoSenha) => Number.isInteger(c.N) && c.N >= 2 ** 4 && c.N <= 2 ** 17 && (c.N & (c.N - 1)) === 0 && Number.isInteger(c.r) && c.r >= 1 && c.r <= 16 && Number.isInteger(c.p) && c.p >= 1 && c.p <= 4

/** `scrypt$N$r$p$sal$hash` (base64url) */
export async function hashSenha(senha: string, custo: CustoSenha = CUSTO_PADRAO): Promise<string> {
  if (!custoValido(custo)) throw new Error('custo de scrypt inválido')
  const sal = randomBytes(16), h = await deriva(senha, sal, custo)
  return `scrypt$${custo.N}$${custo.r}$${custo.p}$${sal.toString('base64url')}$${h.toString('base64url')}`
}

/** confere a senha em tempo constante. `rehash`: o hash guardado usa um custo diferente do atual (reprocessar ao entrar). Hash ausente ou malformado gasta o mesmo tempo e reprova. */
export async function confereSenha(senha: string, hash: string | null | undefined, custoAtual: CustoSenha = CUSTO_PADRAO): Promise<{ ok: boolean; rehash: boolean }> {
  const p = typeof hash === 'string' ? /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(hash) : null
  const c = p ? { N: Number(p[1]), r: Number(p[2]), p: Number(p[3]) } : null
  if (!p || !c || !custoValido(c) || senha.length > SENHA_MAX * 4) { await deriva(senha.slice(0, SENHA_MAX * 4), randomBytes(16), custoAtual).catch(() => null); return { ok: false, rehash: false } } // gasta o mesmo tempo de uma conferência (sem recursão)
  const esperado = Buffer.from(p[5]!, 'base64url'), obtido = await deriva(senha, Buffer.from(p[4]!, 'base64url'), c)
  return { ok: esperado.length === obtido.length && timingSafeEqual(esperado, obtido), rehash: c.N !== custoAtual.N || c.r !== custoAtual.r || c.p !== custoAtual.p }
}
/** gasta o tempo de uma conferência sem usuário (e-mail desconhecido) */
export async function gastaTempoDeSenha(senha: string, custo: CustoSenha = CUSTO_PADRAO): Promise<void> { await deriva(senha.slice(0, SENHA_MAX * 4), randomBytes(16), custo).catch(() => null) }

const COMUNS = new Set(['1234567890', '123456789a', '0123456789', 'senha12345', 'senha123456', 'senhasenha', 'password12', 'password123', 'passw0rd123', 'qwertyuiop', 'qwerty12345', '1q2w3e4r5t', '1qaz2wsx3e', 'abcdefghij', 'abc1234567', 'mudar12345', 'mudar@123456', 'changeme123', 'letmein1234', 'welcome123', 'brasil2020', 'brasil2024', 'brasil@2024', 'admin12345', 'administrador', 'polaris123', 'polarispolaris', 'trocar12345', 'iloveyou123', 'minhasenha', 'minhasenha1', 'minhasenha123'])
/** regras de uma senha nova; devolve as mensagens do que falta (vazio = aceita). Sem exigir símbolos: o que importa é comprimento e não ser óbvia. */
export function politicaDeSenha(senha: string, ctx: { email?: string; nome?: string } = {}): string[] {
  const erros: string[] = [], s = senha.normalize('NFKC'), minus = s.toLowerCase()
  if (s.length < SENHA_MIN) erros.push(`A senha precisa de pelo menos ${SENHA_MIN} caracteres.`)
  if (s.length > SENHA_MAX) erros.push(`A senha aceita até ${SENHA_MAX} caracteres.`)
  if (!erros.length) {
    if (new Set(s).size < 5) erros.push('A senha usa poucos caracteres diferentes.')
    else if (COMUNS.has(minus)) erros.push('Essa senha é muito comum: escolha outra.')
    else if (/^\d+$/.test(s)) erros.push('A senha não pode ter só números.')
    const local = (ctx.email ?? '').split('@')[0]?.toLowerCase() ?? ''
    if (local.length >= 4 && minus.includes(local)) erros.push('A senha não pode conter o seu e-mail.')
    const nome = (ctx.nome ?? '').toLowerCase().replace(/\s+/g, '')
    if (nome.length >= 5 && minus.replace(/\s+/g, '').includes(nome)) erros.push('A senha não pode conter o seu nome.')
  }
  return erros
}
