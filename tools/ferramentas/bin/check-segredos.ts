import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { escaneia, escaneiaDiff, type Achado } from '../src/segredos.ts'

// uso: check-segredos.ts [--all | --historico]   (sem opção: os arquivos em stage). NUNCA imprime o valor encontrado: só regra, arquivo, linha (e o commit, no histórico).
const modo = process.argv[2] ?? ''
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
const raiz = git('rev-parse', '--show-toplevel').trim(); process.chdir(raiz)
let achados: Array<Achado & { commit?: string }> = []
if (modo === '--historico') achados = escaneiaDiff(git('log', '-p', '--all', '--no-color', '--no-ext-diff', '--format=commit %H'))
else {
  const arquivos = (modo === '--all' ? git('ls-files', '-z') : git('diff', '--cached', '--name-only', '--diff-filter=ACM', '-z')).split('\0').filter(Boolean)
  for (const a of arquivos) {
    let txt: string | null = null
    try { const st = statSync(a); if (st.isFile() && st.size <= 2 * 1024 * 1024) { const b = readFileSync(a); txt = b.includes(0) ? null : b.toString('utf8') } } catch { /* submódulo ou removido */ }
    achados.push(...escaneia(a, txt))
  }
}
if (achados.length) {
  for (const a of achados) console.error(`BLOQUEADO [${a.regra}] ${a.arquivo}${a.linha ? `:${a.linha}` : ''}${a.commit ? ` (commit ${a.commit})` : ''}`)
  console.error('\nSegredo em texto puro não pode ir para o repositório. Guarde-o fora do git (docker/segredos/, .env local) e use `X_FILE`. Se for um valor de EXEMPLO que a regra confundiu, marque a linha com: polaris: permite-segredo')
  if (modo === '--historico') console.error('Segredo que já entrou no histórico: REVOGUE/ROTACIONE agora (apagar o commit não desfaz o vazamento) e só depois limpe o histórico (confirmação necessária).')
  process.exit(1)
}
console.log(modo === '--historico' ? 'ok: nenhum segredo em texto puro no histórico' : 'ok: nenhum segredo em texto puro nos arquivos conferidos')
