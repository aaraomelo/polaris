# Qualidade: o que cada camada de teste prova

| Camada | Onde | Prova | Não prova |
|---|---|---|---|
| Unidade e propriedade | todos os pacotes (`vitest`) | regras puras, fuzz contra oráculos (React, CASL, SQL ≡ JS) | integração |
| Integração com **PGlite** (Postgres em WASM, uma sessão) | `schema`, `servico`, `packs`, `gateway`, `apps` | SQL, RLS (com `SET ROLE`), FKs compostas, migrações, serviços ponta a ponta | **concorrência**, locks, deadlock, timeouts do servidor, login de papel real |
| **Postgres real** | `packages/pgreal` | tudo o que a linha de cima não prova (abaixo) | desempenho sob carga de produção |
| Navegador real (CDP) | `engine/bench/navegador` | tempos, INP, hidratação | — |
| Deploy real | `docs/deploy.md` | imagem, compose, stack em modo produção | nginx/TLS, VPS |

## Postgres real (`packages/pgreal`)
`pnpm test:pgreal` sobe um contêiner **descartável** da imagem `postgres:16` **local** (`scripts/pg-real.sh up`; nunca baixa nada) e roda a suíte contra ele. Sem `POLARIS_PG_REAL_URL` os testes são **pulados** (`pnpm test` do monorepo roda em qualquer máquina); no CI há um job com `services: postgres:16`.
Cada arquivo cria o **seu banco**, com os papéis da produção e **login de verdade** (nada de `SET ROLE`): `polaris_migrador` (BYPASSRLS, dono das tabelas), `polaris_app` (sem), `polaris_relay` (BYPASSRLS).

| Teste | Prova |
|---|---|
| `rls` | app sem BYPASSRLS/superusuário; sem tenant a consulta vê nada; tenant não vaza para a conexão seguinte do pool; INSERT/UPDATE/DELETE de outro tenant barrados (inclusive "empurrar" a linha); **FK composta**; único por tenant; o app não altera o esquema nem escala para o migrador |
| `concorrencia` (Estoque) | **oversell**: 5 em estoque e 20 reservas simultâneas → 5; **40 transferências em sentidos opostos sem deadlock**; reservas com itens em ordem diferente sem deadlock; saídas simultâneas nunca negativam; invariante razão = saldo |
| `concorrencia` (Pagamentos, Serviços) | 25 capturas somam exatamente (saldo atômico); estornos simultâneos não excedem; mesma chave 8× = 1 estorno; **12 agendamentos do mesmo horário → 1**; 20 orçamentos → números 1..20 sem buraco |
| `plataforma` | 16 `cria` simultâneas (8 rodadas) = 1 release; 6 promoções simultâneas com diário sem buracos e cadeia coerente; 15 gravações do mesmo nó com `seq` distintos; **10 cadastros do mesmo alias → 1**; mesma chave 8× → 1 tenant; **2 provas de domínio → 1 verificado**; cancelar × suspender sem corrida |
| `timeouts` | `statement_timeout` cancela no banco (57014); transação ociosa derrubada pelo servidor **não derruba o processo**; conexão morta (`pg_terminate_backend`); espera por conexão com prazo; erro desfaz tudo e a conexão volta limpa |

### Defeitos que só o Postgres real mostrou (todos corrigidos)
1. **Processo caía** quando o servidor derrubava uma conexão *emprestada* e ociosa dentro de uma transação (`idle_in_transaction_session_timeout`, rede, failover): o `pg` emite `error` no cliente sem ouvinte → exceção não tratada. Agora o adaptador ouve, descarta a conexão e a transação falha com erro normal. Isto importa: o Pagamentos chama o provedor **dentro** da transação.
2. **Prova de domínio simultânea** deixava **nenhum** tenant verificado (cada prova apagava a reivindicação da outra antes de gravar a sua). Agora grava primeiro e o índice único parcial decide.
3. A criação de release não serializava sem transação real: o desenho exige `db.transacao` (o PGlite escondia isso).

### Mutações que o PGlite não pegava e o Postgres real pega
transferência sem ordem de trava (**deadlock real**), saldo sem `FOR UPDATE` (oversell), reserva sem ordenar itens, agenda sem trava do recurso, carteira lê-modifica-grava (atualização perdida), release sem trava do tenant, status sem trava, verificação de domínio na ordem antiga, adaptador sem ouvinte de erro.

## Limites
- É **um** servidor, **sem** réplica, sem carga: prova correção sob concorrência, não capacidade.
- `fsync=off` no contêiner de teste: não prova durabilidade.
- O isolamento é READ COMMITTED (o padrão); os testes provam que as travas bastam nele, não em outros níveis.
