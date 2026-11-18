// Detector de segredo em texto puro. É a ÚLTIMA barreira antes do git (hook) e a primeira do CI: tem de pegar o que importa, não incomodar com o que não importa, e NUNCA
// imprimir o valor encontrado (só arquivo, linha e a regra: um log de CI com o segredo seria um vazamento novo).

export type Achado = { regra: string; arquivo: string; linha: number }

/** nomes de arquivo que nunca podem ser versionados (só os `.exemplo` e o LEIA-ME entram) */
const NOMES: Array<[string, RegExp]> = [
  ['arquivo-env', /(^|\/)\.env(\.[^/]+)?$/],
  ['env-de-deploy', /(^|\/)docker\/[^/]+\.env$/],
  ['pasta-de-segredos', /(^|\/)(credenciais|segredo|segredos|secrets)\//],
  ['chave-privada-arquivo', /\.(pem|key|p12|pfx|jks|keystore)$|(^|\/)id_(ed25519|rsa|ecdsa|dsa)($|[^.])/],
  ['credencial-git', /\.git-credentials$|(^|\/)\.netrc$|(^|\/)\.npmrc$/],
]
const NOME_PERMITIDO = /(^|\/)(\.env\.exemplo|[^/]+\.env\.exemplo|docker\/segredos\/LEIA-ME\.md)$/

const R = (s: string) => new RegExp(s)
/** o formato de cada credencial conhecida (prefixos e tamanhos reais dos provedores) */
const CONTEUDO: Array<[string, RegExp]> = [
  ['chave-privada', R('-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----')],
  ['github', R('\\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\\b')],
  ['gitlab', R('\\bglpat-[A-Za-z0-9_-]{20,}')],
  ['aws-access-key', R('\\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\\b')],
  ['aws-secret', R('(?:aws_secret_access_key|secret_access_key)["\']?\\s*[:=]\\s*["\']?[A-Za-z0-9/+=]{40}\\b')],
  ['google-api', R('\\bAIza[0-9A-Za-z_-]{35}\\b')],
  ['slack', R('\\bxox[abposr]-[0-9A-Za-z-]{10,}|hooks\\.slack\\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+')],
  ['stripe', R('\\b[sr]k_(?:live|test)_[0-9A-Za-z]{20,}\\b')],
  ['npm', R('\\bnpm_[A-Za-z0-9]{36}\\b')],
  ['atlassian', R('\\bATATT[A-Za-z0-9_=-]{20,}')],
  ['clickup', R('\\bpk_[0-9]{5,}_[A-Z0-9]{20,}\\b')],
  ['anthropic', R('\\bsk-ant-[A-Za-z0-9_-]{20,}')],
  ['openai', R('\\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\\b')],
]
/** JWT de verdade: a ASSINATURA é aleatória (≥ ~5 bits/char e longa); um JWT de exemplo/teste tem assinatura repetida ou curta e não é segredo */
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{40,})/
/** URL com usuário:senha — só vale se a senha NÃO é um marcador óbvio (senha, xxxx, ${VAR}, <…>, exemplo…) */
const URL_COM_SENHA = /\b[a-z][a-z0-9+.-]{1,15}:\/\/([^\s/:@'"`<>]{1,64}):([^\s/@'"`<>]{6,128})@[^\s/'"`<>]+/gi
const MARCADOR = /senha|password|passwd|segredo|secret|changeme|troque|exemplo|example|dummy|fake|teste|test|placeholder|substitua|xxxx|\*\*\*|\.\.\.|\$\{|\$\(|\$[A-Z_]|^%s$|%s|<|\{\{|^x+$|^y+$|^z+$|^a+$/i
/** atribuição de algo com nome de segredo a um literal longo e de alta entropia (fora de testes) */
const ATRIBUICAO = /\b([A-Za-z0-9_]*(?:secret|segredo|passwd|password|senha|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|token)[A-Za-z0-9_]*)["']?\s*[:=]\s*["'`]([A-Za-z0-9+/=_.-]{24,})["'`]/gi

/** bits por caractere (Shannon): texto de gente fica em ~2–3,5; segredo aleatório em base64/hex passa de ~4 */
export function entropia(s: string): number {
  const f = new Map<string, number>(); for (const c of s) f.set(c, (f.get(c) ?? 0) + 1)
  let h = 0; for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p) } return h
}

const PERMITE_LINHA = /polaris:\s*permite-segredo/ // marca explícita, na PRÓPRIA linha, para um valor de exemplo que a regra confunde
const SEM_CONTEUDO = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|tgz|wasm|bin|so|dylib|mp4|mov)$/i // hashes de integridade e binários
const EH_TESTE = /(^|\/)(test|tests|__tests__|fixtures|congelados|golden|exemplos)\/|\.(test|spec)\.[jt]sx?$/

/** Os achados de UM arquivo: o nome (se proibido) e o conteúdo, linha a linha. `conteudo` é texto; binário ou null só passa pelo nome. */
export function escaneia(arquivo: string, conteudo: string | null): Achado[] {
  const out: Achado[] = []
  const nome = arquivo.replace(/\\/g, '/')
  if (!NOME_PERMITIDO.test(nome)) for (const [regra, re] of NOMES) if (re.test(nome)) { out.push({ regra, arquivo, linha: 0 }); break }
  if (conteudo === null || SEM_CONTEUDO.test(nome)) return out
  const teste = EH_TESTE.test(nome)
  const linhas = conteudo.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!; if (PERMITE_LINHA.test(l)) continue
    const longa = l.length > 4000 // linha de bundle/JSON minificado: os FORMATOS conhecidos valem (um segredo escondido numa linha enorme é o caso clássico); só as heurísticas de entropia pulam, por custo e ruído
    for (const [regra, re] of CONTEUDO) if (re.test(l)) { out.push({ regra, arquivo, linha: i + 1 }); break }
    if (out.at(-1)?.linha === i + 1) continue
    const j = JWT.exec(l); if (j && entropia(j[1]!) >= 4.3) { out.push({ regra: 'jwt-assinado', arquivo, linha: i + 1 }); continue }
    if (longa) continue
    URL_COM_SENHA.lastIndex = 0
    for (const m of l.matchAll(URL_COM_SENHA)) if (!MARCADOR.test(m[2]!) && !MARCADOR.test(m[1]!) && m[1]!.toLowerCase() !== m[2]!.toLowerCase() && !teste) { out.push({ regra: 'url-com-senha', arquivo, linha: i + 1 }); break }
    if (teste) continue // fixtures de teste têm "segredos" de mentira por natureza; os formatos conhecidos acima valem em qualquer lugar, a heurística de entropia não
    ATRIBUICAO.lastIndex = 0
    for (const m of l.matchAll(ATRIBUICAO)) if (!MARCADOR.test(m[2]!) && entropia(m[2]!) >= 3.9) { out.push({ regra: 'atribuicao-de-alta-entropia', arquivo, linha: i + 1 }); break }
  }
  return out
}

/** O diff de `git log -p`: só as linhas ADICIONADAS por commit, por arquivo; o achado carrega o commit (curto). */
export function escaneiaDiff(diff: string): Array<Achado & { commit: string }> {
  const out: Array<Achado & { commit: string }> = []; let commit = '', arquivo = '', linha = 0
  const buffer: Record<string, string[]> = {}
  const fecha = () => { for (const [a, ls] of Object.entries(buffer)) for (const x of escaneia(a, ls.join('\n'))) out.push({ ...x, commit, linha: x.linha }) ; for (const k of Object.keys(buffer)) delete buffer[k] }
  for (const l of diff.split('\n')) {
    const c = /^commit ([0-9a-f]{40})/.exec(l); if (c) { fecha(); commit = c[1]!.slice(0, 10); continue }
    const f = /^\+\+\+ b\/(.+)$/.exec(l); if (f) { arquivo = f[1]!; buffer[arquivo] ??= []; linha = 0; continue }
    if (l.startsWith('+++') || l.startsWith('---') || !arquivo) continue
    if (l.startsWith('+')) { buffer[arquivo]!.push(l.slice(1)); linha++ }
  }
  fecha(); void linha; return out
}
