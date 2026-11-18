import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const RAIZ = join(__dirname, '..', '..', '..')
const nginx = readFileSync(join(RAIZ, 'docker/nginx/nginx.conf'), 'utf8'), proxy = readFileSync(join(RAIZ, 'docker/nginx/proxy.conf'), 'utf8')
const compose = parse(readFileSync(join(RAIZ, 'docker/compose.deploy.yml'), 'utf8'), { merge: true }) as { services: Record<string, any>; networks: Record<string, any>; secrets: Record<string, any> }

describe('nginx: a fronteira de REDE (análise estática; `nginx -t` real exige a imagem, ver docs/deploy.md)', () => {
  it('só TLS 1.2/1.3, sem tickets, HTTP só redireciona (e serve o desafio ACME), sem versão no cabeçalho', () => {
    expect(nginx).toMatch(/ssl_protocols TLSv1\.2 TLSv1\.3;/); expect(nginx).not.toMatch(/TLSv1(\.0|\.1)?[ ;]|SSLv/); expect(nginx).toMatch(/ssl_session_tickets off/); expect(nginx).toMatch(/server_tokens off/)
    expect(nginx).toMatch(/return 301 https:\/\/\$host\$request_uri/); expect(nginx).toMatch(/location \/\.well-known\/acme-challenge\//)
    expect(nginx).not.toMatch(/ssl_ciphers[^;]*(RC4|3DES|MD5|NULL|EXPORT|CBC)/i)
  })
  it('cabeçalhos de segurança em TODA resposta (`always`): HSTS, nosniff, anti-frame, referrer, permissões, CSP', () => {
    for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']) expect(nginx, h).toMatch(new RegExp(`add_header ${h} "[^"]+" always;`))
  })
  it('/metrics, /pronto e /saude NUNCA saem para a internet', () => { expect(nginx).toMatch(/location ~ \^\/\(metrics\|pronto\|saude\)\$ \{ return 404; \}/) })
  it('corpo pequeno, prazos curtos e limite por IP — o cadastro público com limite próprio e menor', () => {
    expect(nginx).toMatch(/client_max_body_size 1m;/); expect(nginx).toMatch(/client_body_timeout 10s;/); expect(nginx).toMatch(/limit_req_zone \$binary_remote_addr zone=api:\d+m rate=\d+r\/s;/); const cad = /zone=cadastro:\d+m rate=(\d+)r\/s/.exec(nginx), api = /zone=api:\d+m rate=(\d+)r\/s/.exec(nginx)
    expect(Number(cad![1])).toBeLessThan(Number(api![1])); expect(nginx).toMatch(/location \/publico\/cadastro \{ limit_req zone=cadastro/)
  })
  it('o proxy SOBRESCREVE os cabeçalhos de encaminhamento (nunca confia no do cliente) e zera `X-Tenant-Id`; o Host original segue', () => {
    expect(proxy).toMatch(/proxy_set_header Host \$host;/); expect(proxy).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/); expect(proxy).not.toMatch(/\$proxy_add_x_forwarded_for/); expect(proxy).toMatch(/proxy_set_header X-Tenant-Id "";/); expect(proxy).toMatch(/proxy_hide_header X-Powered-By/)
  })
  it('chaves balanceadas e todo `include` aponta para um arquivo que existe', () => {
    expect([...nginx].filter((c) => c === '{').length).toBe([...nginx].filter((c) => c === '}').length)
    for (const m of (nginx + proxy).matchAll(/include (\/etc\/nginx\/[A-Za-z0-9._/-]+);/g)) { const f = m[1]!; if (f.endsWith('mime.types')) continue; expect(existsSync(join(RAIZ, 'docker/nginx', f.split('/').pop()!)), f).toBe(true) }
  })
})

describe('compose de deploy: o que NÃO pode faltar', () => {
  const app = ['gateway', 'loja'].map((n) => compose.services[n]!)
  it('só o nginx publica porta; o banco só fala na rede interna (sem rota para fora)', () => {
    expect(Object.entries(compose.services).filter(([, s]) => s.ports).map(([n]) => n)).toEqual(['nginx']); expect(compose.networks.interna.internal).toBe(true); expect(compose.services.postgres.networks).toEqual(['interna']); expect(compose.services.postgres.ports).toBeUndefined()
  })
  it('aplicação: não-root, sistema de arquivos somente leitura, sem capacidades, sem escalar privilégio, com limites e healthcheck', () => {
    for (const s of [...app, compose.services.nginx]) { expect(s.read_only, s.image).toBe(true); expect(s.cap_drop).toEqual(['ALL']); expect(s.security_opt).toContain('no-new-privileges:true') }
    for (const s of app) { expect(String(s.user)).toMatch(/\$\{POLARIS_UID:-1000\}/); expect(s.mem_limit).toBeTruthy(); expect(s.cpus).toBeTruthy(); expect(s.pids_limit).toBeTruthy(); expect(s.healthcheck).toBeTruthy() }
  })
  it('NENHUM segredo no ambiente: tudo por `_FILE` e por `secrets:`; JWT por chave pública (JWKS), nunca HS256; produção por padrão', () => {
    const texto = readFileSync(join(RAIZ, 'docker/compose.deploy.yml'), 'utf8'); expect(texto).not.toMatch(/JWT_SEGREDO\b/); expect(texto).not.toMatch(/(SENHA|PASSWORD|TOKEN|SECRET)[A-Z_]*: (?!\/run\/secrets)/)
    for (const s of app) { expect(s.environment.NODE_ENV).toBe('production'); expect(s.environment.JWT_JWKS_URL).toBeTruthy(); for (const [k, v] of Object.entries(s.environment)) if (k.endsWith('_FILE')) expect(String(v)).toMatch(/^\/run\/secrets\//) }
    for (const f of Object.values(compose.secrets)) expect(String((f as { file: string }).file)).toMatch(/^\.\/segredos\//)
  })
  it('a imagem nunca é construída na máquina de deploy e não tem valor padrão (:latest): é obrigatória e vem de fora', () => { for (const s of app) { expect(s.image).toMatch(/\$\{POLARIS_IMAGEM:\?/); expect(s.build).toBeUndefined() } })
  it('o banco local só existe sob PERFIL (homologação); a migração é um serviço à parte, sob perfil, que não reinicia', () => { expect(compose.services.postgres.profiles).toEqual(['banco-local']); expect(compose.services.migra.profiles).toEqual(['migra']); expect(compose.services.migra.restart).toBe('no') })
  it('os exemplos de ambiente não carregam segredo e a produção exige digest, sem migração automática nem introspecção', () => {
    for (const f of ['homolog', 'prod']) expect(readFileSync(join(RAIZ, `docker/${f}.env.exemplo`), 'utf8')).not.toMatch(/^(JWT_SEGREDO|.*(SENHA|PASSWORD|TOKEN|SECRET|KEY)[A-Z_]*)=/im)
    const prod = readFileSync(join(RAIZ, 'docker/prod.env.exemplo'), 'utf8'); expect(prod).toMatch(/^POLARIS_IMAGEM=.*@sha256:/m); expect(prod).toMatch(/^POLARIS_MIGRAR=0$/m); expect(prod).toMatch(/^POLARIS_GRAPHQL_INTROSPECCAO=0$/m)
  })
  it('a pasta de segredos e os .env de deploy são ignorados pelo git (só o LEIA-ME e os .exemplo entram)', () => {
    for (const p of ['docker/segredos/metricas_token', 'docker/prod.env', 'docker/homolog.env']) expect(spawnSync('git', ['check-ignore', '-q', p], { cwd: RAIZ }).status, p).toBe(0)
    for (const p of ['docker/segredos/LEIA-ME.md', 'docker/prod.env.exemplo']) expect(spawnSync('git', ['check-ignore', '-q', p], { cwd: RAIZ }).status, p).toBe(1)
  })
})

describe('scripts/deploy.sh: recusa o inseguro ANTES de subir, e nunca mostra um segredo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaris-deploy-')), D = join(dir, 'docker'), SEG = join(D, 'segredos'), CERT = join(dir, 'certs')
  const run = (amb: string, acao: string, env: Record<string, string> = {}) => spawnSync('bash', [join(RAIZ, 'scripts/deploy.sh'), amb, acao], { encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME!, POLARIS_UID: String(process.getuid!()), POLARIS_GID: String(process.getgid!()), POLARIS_DOCKER_DIR: D, POLARIS_SEM_DOCKER: '1', ...env } })
  const uid = process.getuid!()
  const prepara = () => {
    rmSync(D, { recursive: true, force: true }); mkdirSync(SEG, { recursive: true }); mkdirSync(CERT, { recursive: true })
    copyFileSync(join(RAIZ, 'docker/compose.deploy.yml'), join(D, 'compose.deploy.yml')); cpSync(join(RAIZ, 'docker/nginx'), join(D, 'nginx'), { recursive: true })
    for (const [n, v] of [['metricas_token', 'm'.repeat(32)], ['plataforma_url', 'postgres://p:xxxxxxxx@db/polaris'], ['preview_segredo', 'p'.repeat(48)], ['loja_url_app', 'postgres://a:yyyyyyyy@db/polaris'], ['loja_url_migrador', 'postgres://m:zzzzzzzz@db/polaris']] as const) { writeFileSync(join(SEG, n), v); chmodSync(join(SEG, n), 0o400) }
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(CERT, 'privkey.pem'), '-out', join(CERT, 'fullchain.pem'), '-days', '90', '-subj', '/CN=teste'], { stdio: 'ignore' })
    writeFileSync(join(D, 'prod.env'), ['POLARIS_AMBIENTE=prod', `POLARIS_IMAGEM=registro.exemplo.com/polaris@sha256:${'a'.repeat(64)}`, `POLARIS_NOS=${dir}`, `POLARIS_CERTS=${CERT}`, 'POLARIS_DOMINIO=polaris.exemplo.com', 'JWT_EMISSOR=https://id.exemplo.com', 'JWT_AUDIENCIA=polaris', 'JWT_JWKS_URL=https://id.exemplo.com/jwks.json', 'POLARIS_SERVICOS={"loja":"http://loja:3001"}', 'POLARIS_MIGRAR=0', 'POLARIS_GRAPHQL_INTROSPECCAO=0'].join('\n') + '\n')
  }
  const muda = (arq: string, de: RegExp | string, para: string) => writeFileSync(arq, readFileSync(arq, 'utf8').replace(de, para))
  beforeAll(prepara); afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('configuração correta: passa, e `up` em modo seco imprime o comando sem executar nada', () => {
    prepara(); const r = run('prod', 'verifica'); expect(r.status, r.stderr).toBe(0); expect(r.stdout).toMatch(/pronto para subir/); const u = run('prod', 'up', { POLARIS_DEPLOY_SECO: '1' }); expect(u.status).toBe(0); expect(u.stdout).toMatch(/\[seco\] docker compose/)
  })
  const quebra = (nome: string, mexe: () => void, motivo: RegExp, amb = 'prod') => it(`RECUSA: ${nome}`, () => { prepara(); mexe(); const r = run(amb, 'verifica'); expect(r.status).toBe(1); expect(r.stderr).toMatch(motivo); expect(run(amb, 'up', { POLARIS_DEPLOY_SECO: '1' }).status).toBe(1) }) // `up` também não sobe
  quebra('segredo legível por grupo/outros (modo 0644)', () => chmodSync(join(SEG, 'metricas_token'), 0o644), /modo 644/)
  quebra('segredo ausente', () => rmSync(join(SEG, 'preview_segredo')), /segredo ausente/)
  quebra('segredo vazio', () => { chmodSync(join(SEG, 'loja_url_app'), 0o600); writeFileSync(join(SEG, 'loja_url_app'), ''); chmodSync(join(SEG, 'loja_url_app'), 0o400) }, /vazio/)
  quebra('segredo que parece valor de exemplo', () => { chmodSync(join(SEG, 'metricas_token'), 0o600); writeFileSync(join(SEG, 'metricas_token'), 'troque-este-valor-de-exemplo-aqui'); chmodSync(join(SEG, 'metricas_token'), 0o400) }, /valor de exemplo/)
  quebra('token de métricas curto demais', () => { chmodSync(join(SEG, 'metricas_token'), 0o600); writeFileSync(join(SEG, 'metricas_token'), 'curto'); chmodSync(join(SEG, 'metricas_token'), 0o400) }, /ao menos 16/)
  quebra('segredo que é link simbólico', () => { rmSync(join(SEG, 'plataforma_url')); execFileSync('ln', ['-s', join(SEG, 'loja_url_app'), join(SEG, 'plataforma_url')]) }, /link simbólico/)
  quebra('imagem :latest', () => muda(join(D, 'prod.env'), /POLARIS_IMAGEM=.*/, 'POLARIS_IMAGEM=registro.exemplo.com/polaris:latest'), /nunca :latest/)
  quebra('imagem sem tag nem digest', () => muda(join(D, 'prod.env'), /POLARIS_IMAGEM=.*/, 'POLARIS_IMAGEM=polaris'), /sem tag/)
  quebra('produção com imagem por tag (exige digest)', () => muda(join(D, 'prod.env'), /POLARIS_IMAGEM=.*/, 'POLARIS_IMAGEM=registro.exemplo.com/polaris:1.2.3'), /exige a imagem por DIGEST/)
  quebra('digest de exemplo', () => muda(join(D, 'prod.env'), /POLARIS_IMAGEM=.*/, 'POLARIS_IMAGEM=r/polaris@sha256:SUBSTITUA'), /valor de exemplo/)
  quebra('produção que migra sozinha', () => muda(join(D, 'prod.env'), 'POLARIS_MIGRAR=0', 'POLARIS_MIGRAR=1'), /não migra automaticamente/)
  quebra('introspecção do GraphQL em produção', () => muda(join(D, 'prod.env'), 'POLARIS_GRAPHQL_INTROSPECCAO=0', 'POLARIS_GRAPHQL_INTROSPECCAO=1'), /introspecção/)
  quebra('SEGREDO no arquivo de ambiente', () => writeFileSync(join(D, 'prod.env'), readFileSync(join(D, 'prod.env'), 'utf8') + 'JWT_SEGREDO=abc\n'), /parece SEGREDO/)
  quebra('variável de senha no arquivo de ambiente', () => writeFileSync(join(D, 'prod.env'), readFileSync(join(D, 'prod.env'), 'utf8') + 'BANCO_SENHA=abc\n'), /parece SEGREDO/)
  quebra('certificado ausente', () => rmSync(join(CERT, 'fullchain.pem')), /faltam/)
  quebra('certificado expirando em menos de 7 dias', () => execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(CERT, 'privkey.pem'), '-out', join(CERT, 'fullchain.pem'), '-days', '3', '-subj', '/CN=t'], { stdio: 'ignore' }), /expira em menos de 7 dias/)
  quebra('arquivo de ambiente ausente', () => rmSync(join(D, 'prod.env')), /falta .*prod\.env/)
  it('o uid do contêiner é configurável (POLARIS_UID) e a checagem de dono segue ele', () => { prepara(); expect(run('prod', 'verifica', { POLARIS_UID: String(uid + 1) }).stderr).toMatch(/pertence ao uid/); expect(run('prod', 'verifica', { POLARIS_UID: String(uid) }).status).toBe(0) })
  it('NUNCA imprime o conteúdo de um segredo (nem na saída de erro)', () => { prepara(); chmodSync(join(SEG, 'metricas_token'), 0o644); const r = run('prod', 'verifica'); expect(r.stdout + r.stderr).not.toContain('m'.repeat(32)); expect(r.stdout + r.stderr).not.toContain('xxxxxxxx') })
  it('produção não tem banco local nem cria papéis; homologação só aceita --banco-local na homologação; ambiente inválido é recusado', () => {
    prepara(); expect(run('prod', 'papeis').status).toBe(1); expect(run('prod', 'papeis').stderr).toMatch(/só na homologação/); expect(run('staging', 'verifica').status).toBe(2)
    const u = spawnSync('bash', [join(RAIZ, 'scripts/deploy.sh'), 'prod', 'up', '--banco-local'], { encoding: 'utf8', env: { PATH: process.env.PATH!, POLARIS_DOCKER_DIR: D, POLARIS_SEM_DOCKER: '1', POLARIS_DEPLOY_SECO: '1' } }); expect(u.status).toBe(1)
  })
})

describe('o compose resolve de verdade (precisa do docker; pulado sem ele)', () => {
  const temDocker = spawnSync('docker', ['compose', 'version']).status === 0
  it.skipIf(!temDocker)('`docker compose config` aceita o arquivo com um ambiente completo, em homologação (com banco e migração) e produção', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polaris-cfg-')); try {
      mkdirSync(join(dir, 'segredos')); for (const n of ['metricas_token', 'plataforma_url', 'preview_segredo', 'loja_url_app', 'loja_url_migrador', 'postgres_senha', 'plataforma_url_migrador']) writeFileSync(join(dir, 'segredos', n), 'x'.repeat(40))
      copyFileSync(join(RAIZ, 'docker/compose.deploy.yml'), join(dir, 'compose.deploy.yml')); cpSync(join(RAIZ, 'docker/nginx'), join(dir, 'nginx'), { recursive: true })
      writeFileSync(join(dir, 'x.env'), ['POLARIS_AMBIENTE=homolog', 'POLARIS_IMAGEM=polaris:1.0.0', `POLARIS_NOS=${dir}`, `POLARIS_CERTS=${dir}`, 'POLARIS_DOMINIO=h.exemplo.com', 'JWT_EMISSOR=https://i', 'JWT_AUDIENCIA=p', 'JWT_JWKS_URL=https://i/j', 'POLARIS_SERVICOS={"loja":"http://loja:3001"}'].join('\n'))
      for (const perfis of [[], ['--profile', 'banco-local'], ['--profile', 'migra']]) { const r = spawnSync('docker', ['compose', '-f', join(dir, 'compose.deploy.yml'), '--env-file', join(dir, 'x.env'), ...perfis, 'config', '-q'], { encoding: 'utf8' }); expect(r.status, r.stderr).toBe(0) }
      const sem = spawnSync('docker', ['compose', '-f', join(dir, 'compose.deploy.yml'), '--env-file', join(dir, 'x.env'), 'config'], { encoding: 'utf8' }).stdout; expect(sem).not.toContain('x'.repeat(40)) // o conteúdo dos segredos nunca entra na configuração resolvida
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('Studio no deploy', () => {
  it('o nginx dá ao /studio os cabeçalhos de transporte e NÃO a CSP genérica (que o quebraria); o compose liga o diretório do cliente', () => {
    const nginx = readFileSync(join(RAIZ, 'docker/nginx/nginx.conf'), 'utf8'), compose = readFileSync(join(RAIZ, 'docker/compose.deploy.yml'), 'utf8')
    const bloco = /location \/studio \{([\s\S]*?)\n    \}/.exec(nginx)![1]!
    expect(bloco).toMatch(/limit_req zone=api/); expect(bloco).toMatch(/Strict-Transport-Security/); expect(bloco).not.toMatch(/Content-Security-Policy/i); expect(bloco).toMatch(/include \/etc\/nginx\/proxy\.conf/)
    expect(compose).toMatch(/POLARIS_STUDIO_DIR: \$\{POLARIS_STUDIO_DIR:-\/app\/dist\/studio\}/)
  })
})
