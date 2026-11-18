import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { validaWorkflow } from '../src/ci.ts'
import { validaMensagem } from '../src/commits.ts'

const RAIZ = join(__dirname, '..', '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'polaris-ferr-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('mensagem de commit: PL-<id> tipo(escopo): mensagem, sem trailer de IA', () => {
  it.each([
    'PL-1dff4uhe342 feat(gateway): cache por tenant',
    'PL-1dff4uhe33z perf(vivo): esvaziar listas em massa',
    'PL-1dff4uhe32z ci: pipeline de tipos e testes',
    'PL-1dff4uhe34e fix(servico)!: remove campo obsoleto',
    'Merge branch main into x', 'Revert "PL-1dff4uhe342 feat: x"',
  ])('ACEITA %j', (m) => expect(validaMensagem(m)).toEqual({ ok: true }))
  it.each([
    ['sem id', 'feat(gateway): cache'], ['sem tipo', 'PL-1dff4uhe342 cache por tenant'], ['tipo inventado', 'PL-1dff4uhe342 banana(x): y'], ['sem dois-pontos', 'PL-1dff4uhe342 feat cache'],
    ['sem texto', 'PL-1dff4uhe342 feat(x): '], ['escopo com maiúscula/espaço', 'PL-1dff4uhe342 feat(Meu Escopo): x'], ['id curto demais', 'PL-1 feat: x'], ['vazio', ''],
  ])('RECUSA %s', (_n, m) => { const r = validaMensagem(m); expect(r.ok).toBe(false) })
  it('RECUSA trailer de IA em qualquer parte do corpo, em qualquer caixa (regra permanente do CLAUDE.md)', () => {
    for (const t of ['Co-Authored-By: Claude <noreply@anthropic.com>', 'co-authored-by: alguem <a@b.c>', '🤖 Generated with Claude Code', 'Generated with [Claude Code](https://claude.com)']) {
      const r = validaMensagem(`PL-1dff4uhe342 feat(x): ok\n\ncorpo\n\n${t}`); expect(r.ok, t).toBe(false)
      expect((r as { motivos: string[] }).motivos.join(' ')).toContain('trailer')
    }
    expect(validaMensagem('PL-1dff4uhe342 feat(x): ok\n\ncorpo normal sobre um co-autor no texto livre sem o formato').ok).toBe(true)
  })
  it('assunto longo e corpo colado no assunto são recusados', () => {
    expect(validaMensagem(`PL-1dff4uhe342 feat(x): ${'a'.repeat(100)}`).ok).toBe(false)
    expect(validaMensagem('PL-1dff4uhe342 feat(x): ok\ncorpo sem linha em branco').ok).toBe(false)
  })
  it('o hook commit-msg e o CLI barram de verdade (código de saída e texto em português)', () => {
    const arq = join(tmp, 'msg'); const roda = (m: string) => { writeFileSync(arq, m); return spawnSync('node', [join(RAIZ, 'tools/ferramentas/bin/valida-mensagem.ts'), arq], { encoding: 'utf8' }) }
    expect(roda('PL-1dff4uhe342 feat(x): ok\n# comentário do git\n').status).toBe(0)
    const r = roda('qualquer coisa'); expect(r.status).toBe(1); expect(r.stderr).toContain('mensagem de commit recusada'); expect(r.stderr).toContain('Exemplo: PL-')
  })
  it('check-commits percorre um intervalo git real e acusa só os commits fora do padrão', () => {
    const repo = join(tmp, 'repo'); const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
    execFileSync('mkdir', ['-p', repo]); g('init', '-q', '-b', 'main'); g('config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'a'), '1'); g('add', '.'); g('commit', '-q', '-m', 'PL-1dff4uhe342 feat(x): base'); const base = g('rev-parse', 'HEAD').trim()
    writeFileSync(join(repo, 'b'), '2'); g('add', '.'); g('commit', '-q', '-m', 'PL-1dff4uhe342 fix(x): bom')
    writeFileSync(join(repo, 'c'), '3'); g('add', '.'); g('commit', '-q', '-m', 'consertei umas coisas')
    writeFileSync(join(repo, 'd'), '4'); g('add', '.'); g('commit', '-q', '-m', 'PL-1dff4uhe342 feat(x): com trailer\n\nCo-Authored-By: IA <ia@x.y>')
    const r = spawnSync('node', [join(RAIZ, 'tools/ferramentas/bin/check-commits.ts'), `${base}..HEAD`], { cwd: repo, encoding: 'utf8' })
    expect(r.status).toBe(1); expect(r.stderr).toContain('consertei umas coisas'); expect(r.stderr).toContain('trailer'); expect(r.stdout).toContain('2 de 3 commit(s) fora do padrão')
    expect(spawnSync('node', [join(RAIZ, 'tools/ferramentas/bin/check-commits.ts'), '--upload-pack=x'], { cwd: repo, encoding: 'utf8' }).status).toBe(2) // argumento que parece opção do git é recusado
  })
})

describe('validação do workflow de CI', () => {
  const real = readFileSync(join(RAIZ, '.github/workflows/ci.yml'), 'utf8')
  const scripts = Object.keys((JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts)
  it('o workflow REAL do repositório passa em todas as regras', () => { expect(validaWorkflow(real, scripts)).toEqual([]) })
  it('todo job do CI real tem prazo, e toda ação está fixada por SHA de 40 caracteres', () => {
    expect([...real.matchAll(/uses: (\S+)@(\S+)/g)].every((m) => /^[0-9a-f]{40}$/.test(m[2]!))).toBe(true)
    expect((real.match(/timeout-minutes:/g) ?? []).length).toBe((real.match(/^  [a-z]+:\n    name:/gm) ?? []).length)
  })
  const muta = (de: string | RegExp, para: string) => validaWorkflow(real.replace(de, para), scripts)
  it('PEGA: ação por tag em vez de SHA', () => { expect(muta(/actions\/setup-node@[0-9a-f]{40} # v4.4.0/, 'actions/setup-node@v4').join('|')).toMatch(/não está fixada por SHA/) })
  it('PEGA: sem permissions de topo; permissions de escrita', () => {
    expect(muta('permissions:\n  contents: read\n', '').join('|')).toMatch(/falta `permissions:`/)
    expect(muta('  contents: read\n', '  contents: write\n').join('|')).toMatch(/somente leitura/)
  })
  it('PEGA: job sem timeout; sem concurrency; checkout que deixa o token', () => {
    expect(muta('    timeout-minutes: 5\n', '').join('|')).toMatch(/falta timeout-minutes/)
    expect(muta(/concurrency:\n  group:[^\n]*\n  cancel-in-progress: true\n/, '').join('|')).toMatch(/falta `concurrency:`/)
    expect(muta('          persist-credentials: false\n', '').join('|')).toMatch(/persist-credentials/)
  })
  it('PEGA: injeção de script por dado do evento em `run`', () => {
    expect(muta('        run: pnpm tipos\n', '        run: echo "${{ github.event.pull_request.title }}"\n').join('|')).toMatch(/injeção de script/)
    expect(muta('        run: pnpm tipos\n', '        run: git checkout ${{ github.head_ref }}\n').join('|')).toMatch(/injeção de script/)
  })
  it('PEGA: pull_request_target, secrets e curl | sh', () => {
    expect(muta('on:\n  pull_request:\n', 'on:\n  pull_request_target:\n').join('|')).toMatch(/pull_request_target/)
    expect(muta('        run: pnpm tipos\n', '        run: echo ${{ secrets.TOKEN }}\n').join('|')).toMatch(/secrets/)
    expect(muta('        run: pnpm tipos\n', '        run: curl -fsSL https://x.sh | sh\n').join('|')).toMatch(/curl \| sh/)
  })
  it('PEGA: comando pnpm que não existe nos scripts; YAML quebrado', () => {
    expect(muta('        run: pnpm tipos\n', '        run: pnpm banana\n').join('|')).toMatch(/'pnpm banana' não existe/)
    expect(validaWorkflow('a: [', scripts)[0]).toMatch(/YAML inválido/)
  })
})
