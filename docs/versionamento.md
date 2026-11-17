# Versionamento de schemas

Dois números distintos no envelope do nó:

| Campo | O que é | Quem muda |
|---|---|---|
| `versao` (semver) | revisão do **conteúdo** do nó (a página, o tema…) | o autor, a cada publicação; o registry escolhe a maior publicada |
| `esquema` (inteiro, padrão 1) | **major do schema do kind** a que o nó se conforma | só em quebra do contrato do kind |

## Regras
- Adicionar campo **opcional** ao schema de um kind: não muda o major, não precisa de migração.
- Quebra (renomear, remover, tornar obrigatório, mudar tipo/enum): sobe `ESQUEMA_ATUAL[kind]` e exige a migração N→N+1.
- Migração = documento JSON `polaris://migracao/v1` com ops declarativas: `renomeia`, `define`, `remove`, `mapeia` (ponteiros JSON a partir da raiz do nó).
  Sem código; só se migra de N para N+1; nunca se pula, nunca se desfaz.
- Nó de major **futuro** é recusado. Nó de major antigo é migrado ao registrar (`new Registry({ migrador })`) e validado contra o major atual.
- `test/congelados/v<N>/` guarda fixtures imutáveis de cada major; a suíte migra todas até o atual e valida. Ver `test/congelados/LEIA.md`.
- `Migrador.lacunas()` acusa migração faltando; o teste falha se houver.

## Checklist de uma quebra
1. Criar `kinds/<kind>.schema.json` do novo major (`$id` `.../v<N+1>`) e despachar por `esquema` no envelope.
2. Escrever e registrar a migração N→N+1.
3. Subir `ESQUEMA_ATUAL`.
4. Adicionar `congelados/v<N+1>/`.

## Emissões
`emite(no, alvo)` (packages/schema/src/emissao.ts): json e js e tex em todos os kinds; css em tema; sql em servico; html em pagina.
Mudar o formato de uma emissão é mudança observável (golden files em `test/emissao.test.ts`): atualize o teste de propósito.
