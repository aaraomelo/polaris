import { defineConfig } from 'vitest/config'
// os testes de fuzz do runtime (sequências aleatórias contra o React como oráculo) levam de 3 a 15 s; o padrão de 5 s estourava sob carga
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } })
