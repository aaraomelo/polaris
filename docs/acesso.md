# Autenticação e autorização

Código: `packages/acesso` (puro, sem I/O) e a integração em `packages/servico`; contrato no schema (`kind: papel`). Modelo reaproveitado do `access` do tiffany-erp (regras no formato CASL, condição efetiva → `where`, delegação sem escalada), com o CASL como **oráculo de teste**.

```
JWT ──(criaAutenticadorJwt)──▶ { tenantId, usuario, papeis }
papéis (nós `papel`, herança, cascata tenant→segmento→core) ──▶ regras
rota = (acao, sujeito)  ──▶  resolve(regras)  ──▶  nada → 403 | tudo | onde(cond) → WHERE no SQL + checagem após escrever
```

## Papel (`kind: papel`)
```json
{ "kind": "papel", "id": "vendedor", "spec": {
  "herda": ["leitor"],
  "regras": [
    { "acoes": ["listar","obter","criar","atualizar"], "sujeitos": ["loja.pedido"], "onde": { "criadoPor": "$usuario" }, "campos": ["total","nota"] },
    { "acoes": ["remover"], "sujeitos": ["all"], "negar": true } ] } }
```
- **sujeito** = `servico.entidade` (ou `servico.operacoes` para operação sem entidade), ou `all`. **ação** = `listar|obter|criar|atualizar|remover`, o id de uma operação, ou `manage`. Cada rota do serviço declara o seu `(acao, sujeito)` (`rotasDe`); o OpenAPI mostra em `x-acesso`.
- O schema confere o papel contra os serviços registrados: sujeito inexistente (com "quis dizer…"), ação que não existe naquele sujeito, campo inexistente em `campos` ou em `onde`. `herda` é referência conferida; ciclo e papel inexistente lançam.
- A **cascata** vale por papel: o tenant redefine `vendedor` só para ele. `$usuario` e `$tenant` vêm do token.

## Permissão da rota
`publica` (sem autenticação; precisa de tenant, p. ex. pelo host) · `autenticada` (qualquer **usuário** autenticado) · qualquer outro valor, **inclusive o padrão**, é `protegida`: os papéis decidem. Um serviço com rota protegida e sem a opção `acesso` **nem sobe**. Contexto anônimo (tenant só pelo host, sem usuário) nunca passa de rota pública.

## Semântica de decisão (`resolve`, `permite`, `camposPermitidos`)
`linhas = (⋃ condições dos grants) ∖ (⋃ proibições de linha)`.
- **Negar vence, em qualquer ordem** (o CASL puro depende da ordem). `manage` + `negar remover` → não remove, mesmo com outro papel que permita.
- Proibição **sem condição e sem campos** nega a ação inteira. **Defeito achado no `access` do Tiffany**: o resolvedor deles descartava proibições sem `conditions` ao montar o `where`, então um `cannot('delete','Order')` virava allow-all no filtro; aqui há teste de regressão (e o oráculo CASL concorda).
- Proibição só de `campos` remove campos, não linhas. Variável ausente (`$usuario` sem usuário): o grant **não vale**; a proibição vale para **tudo**.
- **Campos**: interseção das listas dos grants que casam (conservador: nunca mostra mais do que algum grant daria para aquela linha), menos os proibidos. O `id` sempre vai.
- **Regra ilegível** (campo inexistente, operador não suportado) **falha alto**: o serviço responde 403 e reporta; nunca vira "tudo" nem é ignorada.

## Linguagem de condição (MongoQuery)
Igualdade; `$eq $ne $in $nin $gt $gte $lt $lte $exists`; `$not` (por campo); `$and $or $nor`; para campos **lista**: contém (`{tags:'a'}`), `$all`, `$size`, `$elemMatch`. Dinheiro compara como **decimal exato**. Avaliada em JS (decidir sobre uma linha) e **compilada para SQL** (valores sempre por parâmetro; só os nomes de coluna, vindos do schema, entram no texto). **Provado**: 2000 condições aleatórias × 80 linhas (com nulos e listas) dão o mesmo resultado em JS e no Postgres; o fuzz achou o `NOT(NULL)` do SQL (corrigido com `COALESCE`). Fora, de propósito: `$regex` (o POSIX do Postgres difere do regex do JS; risco de ReDoS), `$where`, `$mod`; ordenar **texto** (depende da collation).

## No serviço
- **Listar/obter/atualizar/remover**: a condição entra no `WHERE`; o que está fora do alcance nem é lido e responde **404** (não revela que existe). Os filtros da requisição se combinam com o escopo, nunca o contornam.
- **Criar/atualizar**: depois de gravar, o registro precisa continuar dentro do alcance, senão **403 e a transação desfaz** (ninguém "empurra" o registro para fora do próprio escopo nem cria em nome de outro).
- **Campos**: a resposta só traz o que o papel lê; escrever campo fora da lista é 403 `campo_proibido`.
- **Operações**: o handler recebe `pode(acao, sujeito, linha?, campo?)` para decidir sobre a linha. Nunca confie só na rota.
- `regrasDoRegistry(registry)` (cache por tenant+papéis; `limpa()` ao mudar papéis). Papel desconhecido no token ⇒ 403 reportado.

## JWT (`criaAutenticadorJwt`, `contextoPorJwt`)
Algoritmo de lista fixa **conforme o tipo de chave** (segredo ⇒ só HS*, mínimo 32 bytes; chave pública/JWKS ⇒ só assimétricos): `alg:none` e a **confusão de algoritmo** (HS256 assinado com a chave pública) são recusados — cada um testado com token forjado. `exp` e `sub` obrigatórios; `iss`/`aud` conferidos; `nbf` respeitado; tenant do claim precisa ser **uuid**; papéis, lista de nomes bem formados (≤ 50); token ≤ 8 KB; cabeçalho exatamente `Bearer <jwt>`. **Token presente e inválido é 401 até em rota pública**: nunca cai em anônimo por engano.

## Delegação sem escalada (`podeConceder`)
Do Tiffany: "concede-se no máximo o que se tem". Para uma proposta positiva, algum grant do ator precisa cobrir ações e sujeitos, ter condição igual ou mais ampla (ou provadamente mais restrita: só igualdades; qualquer coisa com `$or`/operadores **nega na dúvida**), campos ⊇ e profundidade atenuada (proposta ≤ ator − 1). Proposta de negação é sempre concedível; quem está proibido de algo não o concede.

## CASL no front
`criaAbility(regras)` monta o `Ability` do CASL **com o matcher estendido** (`$or/$and/$nor/$not`; o CASL padrão não os conhece e `{ $or: [...] }` nunca casa). `paraCasl` entrega as regras como estão (só o atalho `{ $not: 'x' }` vira `{ $not: { $eq: 'x' } }`); `paraCaslBasico` converte para forma normal disjuntiva para o CASL padrão e lança o que não representa. O servidor decide com `permite/resolve`, que concordam com o CASL (oráculo: 800 conjuntos de regras × 8 linhas, com campos, `$or` e listas).

## Limites
- Sem o gerenciamento de usuários/atribuição de papéis (fica para o editor, E8) nem refresh/revogação de token (use `exp` curto; revogação exige lista no emissor).
- A delegação existe como função pura; ainda não há endpoint que a aplique.
- Campos por **linha** (um grant dá `total` para uma linha e `nota` para outra) viram a interseção, por segurança.
- Operações sem entidade (`servico.operacoes`) não têm condição de linha.
