import { defineConfig } from 'vitest/config'
// os testes de fuzz do runtime (sequências aleatórias contra o React como oráculo) levam de 3 a 15 s sozinhos e mais de 60 s com a suíte inteira rodando junto (Chrome, Postgres)
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 60_000 } })
