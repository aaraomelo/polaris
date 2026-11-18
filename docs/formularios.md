# Formulários declarativos (`kind: formulario`)

Um formulário é um nó JSON: **campos** tipados, **formato e máscara**, **validação** (por campo e entre campos), **mensagens de erro** (com idiomas) e **ações** (enviar, limpar, voltar, avançar…). O mesmo JSON e o mesmo motor (`packages/engine/src/formulario`) validam no navegador (feedback na hora) e no servidor (a validação que **vale**). O envio chama uma operação REAL de um serviço, conferida contra o contrato dele quando o nó é validado.

Exemplos completos: `packages/schema/test/exemplos/validos/formulario-contato.json` (máscaras, campos condicionais, regras, i18n, envio) e `formulario-passos.json` (assistente em passos, lista, opções vindas de `dados`).

```json
{ "kind": "formulario", "id": "contato", "versao": "1.0.0", "spec": {
  "titulo": "Fale conosco",
  "campos": [
    { "nome": "email", "tipo": "email", "obrigatorio": true, "normaliza": ["aparar", "minusculas"] },
    { "nome": "telefone", "tipo": "telefone", "mascara": { "padrao": ["(00) 0000-0000", "(00) 00000-0000"] } },
    { "nome": "mensagem", "tipo": "textoLongo", "obrigatorio": true, "validacao": { "tamanhoMinimo": 10 } } ],
  "envio": { "servico": "loja", "operacao": "criarContato" },
  "acoes": [{ "id": "enviar", "rotulo": "Enviar", "tipo": "enviar", "estilo": "primario" }] } }
```

## Campos

| Propriedade | O que faz |
|---|---|
| `nome`, `tipo` | `nome` é a chave do valor (`[a-z][A-Za-z0-9]*`, único no nível; `valores`, `valor`, `item` e nomes de protótipo são reservados). Tipos: `texto textoLongo senha email telefone url numero inteiro dinheiro percentual booleano escolha multiescolha data hora dataHora cpf cnpj cep arquivo oculto grupo lista` |
| `rotulo`, `ajuda`, `placeholder`, `rotuloAria` | textos (string ou `{ "pt-BR": …, "en": … }`) |
| `obrigatorio`, `obrigatorioSe` | `obrigatorioSe` é uma expressão sobre `valores` (obrigatório só quando verdadeira). Em `booleano`, obrigatório significa **marcado** (aceite de termos) |
| `se` | o campo só aparece **e só valida** quando verdadeira; oculto é descartado do resultado (`limpaSeOculto: false` mantém) |
| `padrao`, `somenteLeitura`, `desabilitado`, `desabilitadoSe`, `calculado` | **o servidor ignora o que o navegador manda nestes campos** (vale o `padrao` ou o cálculo): não dá para forjar um preço somente leitura |
| `normaliza` | `aparar colapsaEspacos minusculas maiusculas capitaliza semAcentos apenasDigitos apenasLetras`, em ordem, antes de validar. Padrões: e-mail `aparar+minusculas`; CPF/CNPJ/CEP/telefone `apenasDigitos`; texto `aparar` |
| `opcoes` | `escolha`/`multiescolha`: lista `{valor, rotulo, desabilitado, se, grupo}` ou `{ "dados": "<nó dados>", "valor": expr, "rotulo": expr }`. O valor volta ao tipo da opção (`"1"` → `1`) |
| `campos` | `grupo`/`lista`: os campos de cada item (escopo próprio; até 4 níveis); erro em `lista.1.rua` |
| `autocompletar`, `teclado`, `colunas` | dicas de interface |

## Máscaras

`mascara: { padrao, substituto?, mostraLiterais?, enviaComLiterais?, maiusculas? }`. Símbolos do padrão: **`0`** dígito (obrigatório) · **`9`** dígito (opcional) · **`A`** letra · **`a`** letra ou dígito · **`*`** qualquer caractere · o resto é **literal** (`\` escapa um símbolo).

| Padrão | Digitando `12345678901` |
|---|---|
| `000.000.000-00` (CPF) | `123.456.789-01` |
| `00.000.000/0000-00` (CNPJ) · `00000-000` (CEP) | idem |
| `["(00) 0000-0000", "(00) 00000-0000"]` | 10 dígitos: `(11) 2222-3333`; ao digitar o 11º, vira `(11) 92222-3333` |
| `["AAA-0000", "AAA0A00"]` (placa) | `ABC1D23` cai no segundo padrão |

- Com **vários padrões** vale o que perde menos do que foi digitado (o primeiro, no empate).
- **Colar** `123.456.789-01`, com lixo ou sem literais, dá o mesmo resultado; o que não cabe na posição é descartado.
- **Valor guardado e enviado**: sem os literais (`12345678901`); com `enviaComLiterais: true`, com eles. `validacao.padrao` vale para o valor **guardado**.
- A máscara **incompleta** é erro de `formato`. `substituto` (ex.: `_`) preenche as posições vazias na exibição.
- A validação do nó confere a máscara com o tipo: CPF exige 11 posições de dígito, CNPJ 14, CEP 8, telefone 10 ou 11 por padrão; `senha`, `booleano`, `escolha`, `arquivo`… não têm máscara.

## Formato (como o valor é lido e mostrado)

`formato`: `casasDecimais` (0–8), `moeda` (`BRL USD EUR`, só em `dinheiro`), `separadorDecimal`, `agrupaMilhar`, `prefixo`/`sufixo`, `formatoData` (`dd/MM/yyyy`, `yyyy-MM-dd`, `MM/dd/yyyy`; o valor guardado é **sempre ISO**). Dinheiro e percentual ficam em **decimal exato em texto** (`"1234.50"`), nunca em ponto flutuante: `100.0000000000000001` passa de `100`. `dinheiro` aceita no máximo 2 casas.

## Validação

Ordem por campo: vazio → `obrigatorio`; tipo/formato (CPF e CNPJ **com dígito verificador**, telefone com DDD, e-mail, URL http/https, data real com ano bissexto) → máscara completa → `tamanhoMinimo/Maximo` (em caracteres, emoji conta 1) → `padrao` → `minimo/maximo` (exatos) → datas (`dataMinima/dataMaxima`: ISO, `hoje`, `hoje+30d`, `hoje-18a`; "hoje" é a data do **servidor**) → opções, `itensMinimo/Maximo`, arquivo (`extensoes`, `tamanhoMaximoBytes`) → `igualA`/`diferenteDe` (confirmação de senha) → `regras`.

- **Regra por expressão** (`validacao.regras[]: { id?, expr, mensagem }`): vê `valor` e `valores`; verdadeira = válido. **Se a expressão falhar ao executar, a regra reprova** (nunca aprova em silêncio). `se` que falha mantém o campo visível.
- **Regra entre campos** (`validacoes[]: { id, regra, mensagem, campos?, quando? }`): `campos` diz onde o erro aparece (sem `campos`, vai para `_formulario`); `quando`: `alterar`, `sair` ou `enviar` (padrão).
- `validacao.padrao` é uma expressão regular **segura**: a validação do nó recusa repetição aninhada (`(a+)+`), retrovisor e lookaround (ReDoS).
- **Passos** (`passos` exclui `secoes`): cada passo valida só os seus campos antes de avançar; todo campo precisa estar em um passo.

## Mensagens de erro

`mensagens` (no formulário, vale para todos; no campo, só para ele): `obrigatorio minimo maximo tamanhoMinimo tamanhoMaximo padrao formato tipo igualA diferenteDe opcao itensMinimo itensMaximo dataMinima dataMaxima extensao tamanhoArquivo envio sucesso`. Placeholders: `{rotulo} {valor} {min} {max} {tamanho} {outro}`. Cada texto pode ser `{ "pt-BR": …, "en": … }`; o idioma vem do pedido (`idioma` ou `Accept-Language`), depois de `spec.idioma`, depois `pt-BR`. Sem texto do autor, vale o padrão do sistema (pt-BR e en). A mensagem nunca mostra `undefined`.

## Envio e ações

`envio: { servico, operacao, args?, idempotencia?, timeoutMs?, sucesso?, erro? }`. `args` mapeia argumento → expressão sobre `valores`; sem `args`, cada campo vai com o próprio nome. A validação do nó confere que a operação **existe**, que os argumentos são aceitos e que os **obrigatórios** vão. `sucesso: { mensagem, limpar, acoes[] }` e `erro: { mensagem, mapeiaCampos, acoes[] }` usam as ações da página (`definir`, `executar`, `navegar`).

Ações (`acoes[]`): `tipo` `enviar limpar cancelar voltar avancar personalizada`; `estilo`, `se`, `desabilitadoSe`, `validar`, `confirmar: { mensagem… }` (ex.: apagar tudo); `enviar` exige `envio`, `voltar/avancar` exigem `passos`, `personalizada` exige `acoes`.

## API do gateway

- `GET /bff/formularios/:id` → `{ id, versao, spec }` (do registro **do tenant**; de outro tenant é 404).
- `POST /bff/formularios/:id` com `{ valores, campos?, idioma? }`:
  - **422** `{ erro: { codigo: "formulario_invalido" }, erros: [{ campo, regra, mensagem }] }` se não valida;
  - `campos` (nomes de um passo) valida só aquele passo e **não envia** (`{ ok, passo: true }`);
  - válido e sem `envio`: `{ ok, valores }` (normalizados);
  - válido com `envio`: chama o serviço com os valores **normalizados** (nunca o cru; campos que não são do formulário são descartados) e devolve `{ ok, resultado, sucesso: { mensagem, limpar, acoes } }`. O tenant e o usuário vêm **só do token/host**.
  - Erro de validação do **serviço** (`detalhes[].caminho = /campo`) vai para o campo de mesmo nome (`regra: "servico"`); outros 4xx passam com a mensagem do autor; 5xx vira `502/504` com a mensagem `envio`.
  - **Idempotência**: com `Idempotency-Key` (8–100 caracteres), o duplo clique devolve o mesmo resultado (`idempotent-replay: true`) sem chamar o serviço de novo; vale por tenant+usuário+formulário por 10 min; **falha não fica presa à chave**.
  - Limite de corpo 256 KB e de taxa (custo 3).

## Limites (conhecidos)

- **Ainda não há bloco que desenhe o formulário** nas páginas nem editor no Studio: hoje o JSON, o motor, a validação no servidor e o envio existem; o cliente monta a tela com o motor (`@polaris/engine`).
- Opções vindas de `dados` **não são conferidas no servidor** (o serviço continua validando o valor que recebe).
- `arquivo` valida nome, extensão e tamanho declarados; **não há envio de arquivo** pelo gateway ainda.
- `unico` (valor único por consulta ao serviço) e CAPTCHA/anti-spam não existem.
