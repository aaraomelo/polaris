import { readFileSync } from 'node:fs'
import { validaMensagem } from '../src/commits.ts'

// uso: valida-mensagem.ts <arquivo da mensagem>   (o hook commit-msg passa $1)
const r = validaMensagem(readFileSync(process.argv[2] ?? '', 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n').trim())
if (!r.ok) { console.error(`✗ mensagem de commit recusada:\n${r.motivos.map((m) => `  - ${m}`).join('\n')}\n\nExemplo: PL-1dff4uhe342 feat(gateway): cache por tenant`); process.exit(1) }
