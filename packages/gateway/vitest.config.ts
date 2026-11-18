import { defineConfig } from 'vitest/config'

// Cada arquivo de teste sobe um Postgres em WASM (PGlite) no `beforeAll`: com o monorepo inteiro rodando em paralelo, os 10 s padrão estouram sem que nada esteja errado.
export default defineConfig({ test: { hookTimeout: 90_000, testTimeout: 60_000 } })
