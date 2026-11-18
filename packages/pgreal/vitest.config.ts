import { defineConfig } from 'vitest/config'

// Estes testes falam com um Postgres REAL (POLARIS_PG_REAL_URL). Sem ele, TODOS são pulados (e dizem que foram): `pnpm test` do monorepo continua rodando em qualquer máquina.
// Arquivos em série: eles compartilham um servidor (e criam um banco cada um, mas as funções/papéis são do cluster).
export default defineConfig({ test: { hookTimeout: 120_000, testTimeout: 90_000, fileParallelism: false } })
