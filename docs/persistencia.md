# Persistência: schema → SQL (Postgres)

`emite(servico, 'sql')` gera o DDL; `migraSql(anterior, atual)` gera a migração entre duas versões. Tudo é verificado contra um **Postgres real** (PGlite, Postgres 18 em WASM, no processo) em `packages/schema/test/postgres.test.ts` e `migracao-sql.test.ts`.

## O que cada entidade ganha
`id uuid` (PK, `gen_random_uuid()`), `tenant_id uuid NOT NULL`, as colunas dos campos, `criado_em`/`atualizado_em`; índice por `tenant_id`, índice único `(tenant_id, id)`, os `indices` declarados (sempre prefixados por `tenant_id`) e **RLS**:
```sql
ALTER TABLE … ENABLE ROW LEVEL SECURITY;  ALTER TABLE … FORCE ROW LEVEL SECURITY;   -- vale até para o dono
CREATE POLICY … USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```
- A aplicação faz `set_config('app.tenant_id', <uuid>, false)` na conexão (ou `SET LOCAL` na transação) e usa um papel **sem** `BYPASSRLS`.
- **Falha fechada**: sem tenant, ou com o parâmetro vazio (sobra de um `RESET` em conexão reutilizada), a consulta volta **vazia** e a escrita é recusada. Antes a política dava erro de configuração com o parâmetro vazio (achado pelo teste no Postgres).
- `USING` cobre SELECT/UPDATE/DELETE; `WITH CHECK` cobre INSERT e o UPDATE que tentaria mover a linha para outro tenant.

## Tipos
`dinheiro` = `numeric(19,4)` (soma exata: 0,1 + 0,2 = 0,3000; cabem 15 inteiros), `dataHora` = `timestamptz`, `uuid`, `jsonb`, listas como `tipo[]` (json é sempre `jsonb`).

## Referências entre entidades: `referencia`
Campo `uuid` com `referencia: "outraEntidade"` vira **chave estrangeira composta `(tenant_id, id)`**. Motivo (do contrato de isolamento transitivo do Tiffany, "a chave não cruza inquilinos"): as checagens de integridade do Postgres **ignoram a RLS**, então um FK simples deixaria um tenant apontar para a linha de outro sabendo o id. Remover a linha referenciada é recusado (restringe). Recusado na emissão: referência a entidade inexistente, em lista, ou em campo que não é `uuid`.

## Migrações (`migraSql`)
Resultado: `{ up, mudancas, destrutivas, bloqueios, avisos, ok }`. `up` é uma transação (`BEGIN; SET LOCAL row_security = off; …; COMMIT;`) e **precisa rodar com papel `BYPASSRLS`/superusuário**: com `FORCE RLS` o dono comum não enxerga linhas para preencher ou converter.

| Mudança | Tratamento |
|---|---|
| entidade nova, campo novo (opcional ou com `padrao`), índice novo/removido, padrão alterado, obrigatório→opcional, alargar tipo (`inteiro→decimal/dinheiro`, `dinheiro→decimal`, `uuid→texto`, `data→dataHora`) | seguro, em `up` |
| opcional→obrigatório **com** `padrao` | preenche os nulos e aplica `NOT NULL` |
| campo obrigatório novo **sem** `padrao`; opcional→obrigatório sem `padrao` | **bloqueio** (`ok: false`): precisa de decisão humana |
| remover campo ou entidade, estreitar tipo | **destrutivo**: fora do `up`, listado em `destrutivas`; entra com `{ destrutivo: true }` |
| renomear campo | só com `{ renomeia: { 'entidade.campoAntigo': 'campoNovo' } }` (preserva o dado); sem isso parece remover + criar |
| FK nova sobre dados existentes | avisa: a chave é validada contra as linhas atuais |

**Equivalência testada**: aplicar v1 e depois a migração dá o mesmo catálogo (colunas, tipos, nulidade, padrões, índices, políticas, RLS, FKs) que aplicar v2 do zero, e os dados existentes sobrevivem, com a RLS valendo também nas tabelas novas.

## Limites
- Não detecta renomeação de **entidade** (vira remover + criar); mudar o `id` do serviço (outro schema) é recusado.
- Conversões não seguras (texto→inteiro) só geram o `ALTER … USING col::tipo`, que pode falhar com dados incompatíveis: por isso são destrutivas.
- Sem `down`: reverter é escrever a migração inversa (a mesma função, trocando as versões).
