import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { entropia, escaneia, escaneiaDiff } from '../src/segredos'

const RAIZ = join(__dirname, '..', '..', '..')
// Os segredos de TESTE nascem em tempo de execução (concatenados/aleatórios): o arquivo de teste em si não pode ser o que o detector bloqueia.
const alea = (n: number, alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => Array.from(randomBytes(n), (b) => alfabeto[b % alfabeto.length]).join('')
const regras = (arquivo: string, conteudo: string | null) => escaneia(arquivo, conteudo).map((a) => a.regra)

describe('nomes de arquivo que nunca entram', () => {
  it.each(['.env', '.env.local', '.env.producao', 'apps/x/.env', 'docker/prod.env', 'docker/homolog.env', 'chaves/server.pem', 'a/b.key', 'id_rsa', '.ssh/id_ed25519', 'x/credenciais/a.json', 'docker/segredos/metricas_token', '.git-credentials', '.npmrc', 'cert.p12'])('BLOQUEIA %s', (n) => expect(escaneia(n, null).length).toBe(1))
  it.each(['.env.exemplo', 'docker/prod.env.exemplo', 'docker/homolog.env.exemplo', 'docker/segredos/LEIA-ME.md', 'src/env.ts', 'docs/segredos.md', 'environment.md', 'chave-publica.json', 'id_rsa.pub'])('PERMITE %s', (n) => expect(escaneia(n, null)).toEqual([]))
})

describe('formatos de credencial conhecidos (valem em QUALQUER arquivo, até em teste)', () => {
  const casos: Array<[string, string]> = [
    ['chave-privada', '-----BEGIN ' + 'RSA PRIVATE KEY-----'], ['chave-privada', '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'], ['chave-privada', '-----BEGIN ' + 'EC PRIVATE KEY-----'], ['chave-privada', '-----BEGIN ' + 'PRIVATE KEY-----'], ['chave-privada', '-----BEGIN ' + 'PGP PRIVATE KEY BLOCK-----'],
    ['github', 'tok = "ghp' + '_' + alea(36) + '"'], ['github', 'x gho' + '_' + alea(36)], ['github', 'github' + '_pat_' + alea(40)],
    ['gitlab', 'glpat' + '-' + alea(22)], ['aws-access-key', 'AKIA' + alea(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')], ['aws-access-key', 'ASIA' + alea(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')],
    ['aws-secret', 'aws_secret' + '_access_key = "' + alea(40) + '"'], ['google-api', 'chave: AIza' + alea(35)], ['slack', 'xoxb' + '-' + alea(24)], ['slack', 'https://hooks.slack' + '.com/services/T' + alea(8, 'ABCDEFGH12345') + '/B' + alea(8, 'ABCDEFGH12345') + '/' + alea(24)],
    ['stripe', 'sk_live' + '_' + alea(30)], ['stripe', 'rk_test' + '_' + alea(30)], ['npm', 'npm' + '_' + alea(36)], ['atlassian', 'ATATT' + alea(40)], ['clickup', 'pk' + '_12345678_' + alea(28, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')],
    ['anthropic', 'sk-ant' + '-api03-' + alea(40)], ['openai', 'sk' + '-proj-' + alea(40)],
    ['jwt-assinado', 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9' + '.eyJzdWIiOiJhbmEifQ.' + alea(86, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_')],
  ]
  it.each(casos.map(([r, c]) => [r, c.slice(0, 18)] as const))('PEGA %s (%s…)', (regra) => { const c = casos.find(([r]) => r === regra)!; expect(regras('src/a.ts', c[1])).toContain(regra); expect(regras('test/a.test.ts', c[1]), 'em teste também').toContain(regra) })
  it('pega no meio de uma linha comum e em arquivo de qualquer tipo', () => { for (const arq of ['a.json', 'b.yaml', 'c.md', 'd.sh', 'Dockerfile', 'e.ts']) expect(regras(arq, `// ver abaixo\nconst x = { token: 'ghp${'_'}${alea(36)}' }\n`)).toEqual(['github']) })
  it('informa a LINHA certa e nunca o valor', () => { const seg = 'ghp' + '_' + alea(36); const a = escaneia('x.ts', `a\nb\nc = '${seg}'\nd`); expect(a).toEqual([{ regra: 'github', arquivo: 'x.ts', linha: 3 }]); expect(JSON.stringify(a)).not.toContain(seg) })
})

describe('URL com senha e atribuição de alta entropia', () => {
  it('URL com credencial REAL (senha aleatória) é bloqueada; marcadores, senha = usuário, variáveis e exemplos não', () => {
    expect(regras('src/db.ts', `const u = 'postgres://app:${alea(24)}@db.interno:5432/x'`)).toEqual(['url-com-senha']); expect(regras('docs/a.md', `redis://default:${alea(20)}@cache:6379`)).toEqual(['url-com-senha'])
    for (const ok of ['postgres://app:SENHA@db/x', 'postgres://app:senha-secreta@db/x', 'postgres://postgres:postgres@127.0.0.1/x', 'postgres://u:${SENHA_DB}@db/x', 'postgres://u:$DB_PASS@db/x', 'postgres://u:<senha>@db/x', 'postgres://u:xxxxxxxx@db/x', 'postgres://u:exemplo123@db/x', 'amqp://guest:guest@localhost', 'https://exemplo.com/a:b@c', 'http://jwks:8099/jwks.json', 'postgres://app:%s@db/x', 'postgres://u:changeme-agora@db/x']) expect(regras('src/db.ts', ok), ok).toEqual([])
  })
  it('em TESTES a URL com senha é tolerada (fixture), mas fora deles não', () => { const u = `postgres://app:${alea(24)}@db/x`; expect(regras('packages/x/test/a.test.ts', u)).toEqual([]); expect(regras('packages/x/src/a.ts', u)).toEqual(['url-com-senha']) })
  it('atribuição de segredo a literal ALEATÓRIO é bloqueada fora de teste; texto legível, repetido, curto, variável ou placeholder não', () => {
    expect(regras('src/c.ts', `const apiKey = "${alea(32)}"`)).toEqual(['atribuicao-de-alta-entropia']); expect(regras('c.yaml', `client_secret: '${alea(40)}'`)).toEqual(['atribuicao-de-alta-entropia']); expect(regras('c.env.ts', `AUTH_TOKEN="${alea(30)}"`)).toEqual(['atribuicao-de-alta-entropia'])
    for (const ok of ['const senha = "a minha senha tem muitas palavras comuns aqui"', `const token = "${'ab'.repeat(20)}"`, 'password: "curta"', 'const segredo = process.env.SEGREDO_FORTE_DO_SISTEMA', `const token = ${'x'.repeat(40)}`, 'token: "dev-metricas-token-16+"', 'JWT_SEGREDO: "dev-segredo-jwt-com-mais-de-32-caracteres"']) expect(regras('src/c.ts', ok), ok).toEqual([])
    expect(regras('packages/a/test/c.test.ts', `const apiKey = "${alea(32)}"`)).toEqual([]) // fixture de teste
  })
  it('entropia: texto de gente < 4, aleatório > 4,5', () => { expect(entropia('aaaaaaaa')).toBe(0); expect(entropia('um texto qualquer em português')).toBeLessThan(4); expect(entropia(alea(64))).toBeGreaterThan(4.5) })
})

describe('o que NÃO deve incomodar', () => {
  it('lockfile (hashes de integridade), binários, JWT de exemplo (assinatura repetida), linha marcada e linha gigante', () => {
    expect(regras('pnpm-lock.yaml', `integrity: sha512-${alea(86, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')}==\n  token: ${alea(40)}`)).toEqual([]); expect(regras('a.png', 'ghp' + '_' + alea(36))).toEqual([])
    expect(regras('t.ts', "const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbmEifQ.assinaturaassinaturaassinatura'")).toEqual([]); expect(regras('t.ts', "const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbmEifQ.curta'")).toEqual([])
    expect(regras('d.md', `exemplo: ghp${'_'}${alea(36)} // polaris: permite-segredo`)).toEqual([]); expect(regras('min.js', `x="${'a'.repeat(4500)} ghp${'_'}${alea(36)}"`)).toEqual(['github']) // linha gigante: o formato conhecido AINDA é pego (segredo escondido em JSON minificado)
    expect(regras('min.js', `x="${'a'.repeat(4500)} apiKey = '${alea(40)}'"`)).toEqual([]) // …mas a heurística de entropia não roda em linha gigante (ruído)
    expect(regras('t.ts', `const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbmEifQ.${'assinatura'.repeat(6)}'`)).toEqual([]) // assinatura longa mas REPETIDA: exemplo, não segredo
    expect(regras('d.md', 'O hash do commit é 5edaeea4b4f3c1a2b3d4e5f60718293a4b5c6d7e e a versão é 1.2.3.')).toEqual([])
  })
  it('a marca de permissão vale SÓ para a própria linha (a seguinte continua sendo conferida)', () => { const s = 'ghp' + '_' + alea(36); expect(regras('a.md', `${s} // polaris: permite-segredo\n${s}`)).toEqual(['github']); expect(escaneia('a.md', `${s} // polaris: permite-segredo\n${s}`)[0]!.linha).toBe(2) })
})

describe('o histórico (diff de `git log -p`)', () => {
  const diff = (adicionadas: string[], removidas: string[] = []) => ['commit ' + 'a'.repeat(40), 'Author: x', '', '    msg', '', 'diff --git a/src/x.ts b/src/x.ts', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -1 +1 @@', ...removidas.map((l) => '-' + l), ...adicionadas.map((l) => '+' + l)].join('\n')
  it('pega o segredo ADICIONADO em um commit; o que foi só removido não conta; informa o commit', () => {
    const s = 'ghp' + '_' + alea(36); expect(escaneiaDiff(diff([`const t = '${s}'`]))).toEqual([{ regra: 'github', arquivo: 'src/x.ts', linha: 1, commit: 'aaaaaaaaaa' }]); expect(escaneiaDiff(diff(['ok'], [`const t = '${s}'`]))).toEqual([])
  })
})

describe('a ferramenta de linha de comando (repositório git de verdade)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaris-seg-')); afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  const cli = (...a: string[]) => spawnSync('node', [join(RAIZ, 'tools/ferramentas/bin/check-segredos.ts'), ...a], { cwd: dir, encoding: 'utf8' })
  const SEG = 'ghp' + '_' + alea(36)
  git('init', '-q', '-b', 'main'); git('config', 'commit.gpgsign', 'false')
  it('em stage: limpo passa; com segredo bloqueia (exit 1), diz arquivo e linha e NUNCA mostra o valor', () => {
    writeFileSync(join(dir, 'a.txt'), 'nada\n'); git('add', '.'); expect(cli().status).toBe(0)
    writeFileSync(join(dir, 'b.ts'), `x\nconst t = '${SEG}'\n`); git('add', '.'); const r = cli(); expect(r.status).toBe(1); expect(r.stderr).toMatch(/BLOQUEADO \[github\] b\.ts:2/); expect(r.stdout + r.stderr).not.toContain(SEG)
    writeFileSync(join(dir, '.env'), 'X=1\n'); git('add', '-f', '.env'); expect(cli().stderr).toMatch(/BLOQUEADO \[arquivo-env\] \.env/)
  })
  it('--all pega o que está versionado; o histórico pega o que JÁ vazou mesmo depois de removido, e manda ROTACIONAR', () => {
    git('rm', '-q', '--cached', '.env'); rmSync(join(dir, '.env')); git('add', '.'); git('commit', '-q', '-m', 'com segredo'); expect(cli('--all').status).toBe(1)
    writeFileSync(join(dir, 'b.ts'), 'limpo\n'); git('add', '.'); git('commit', '-q', '-m', 'removi'); expect(cli('--all').status).toBe(0) // a árvore está limpa
    const h = cli('--historico'); expect(h.status).toBe(1); expect(h.stderr).toMatch(/BLOQUEADO \[github\] b\.ts/); expect(h.stderr).toMatch(/commit [0-9a-f]{10}/); expect(h.stderr).toMatch(/REVOGUE\/ROTACIONE/); expect(h.stdout + h.stderr).not.toContain(SEG)
  })
  it('o repositório REAL do Polaris está limpo: árvore e histórico', () => { for (const m of ['--all', '--historico']) { const r = spawnSync('node', [join(RAIZ, 'tools/ferramentas/bin/check-segredos.ts'), m], { cwd: RAIZ, encoding: 'utf8' }); expect(r.status, r.stderr).toBe(0) } })
})
