# Catálogo de blocos

71 blocos. Gerado do registry (`pnpm catalogo`); não edite à mão: a fonte é o nó de cada bloco.

## commerce

### Carrinho (`commerce/carrinho`)

Itens do carrinho (do contrato `carrinho.obterCarrinho`) e o resumo. Vazio mostra a mensagem. O slot `acoes` recebe "Finalizar compra".

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desconto` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |
| `frete` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |
| `itens` | lista | sim |  |  |
| `subtotal` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |
| `total` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `acoes` | qualquer bloco |  |  |

**Exemplo: Com itens**

```json
{
  "bloco": "commerce/carrinho",
  "props": {
    "itens": [
      {
        "id": "i1",
        "nome": "Pão de queijo 500 g",
        "quantidade": 2,
        "precoUnitario": "24.90",
        "total": "49.80"
      },
      {
        "id": "i2",
        "nome": "Café 250 g",
        "quantidade": 1,
        "precoUnitario": "18.50",
        "total": "18.50"
      }
    ],
    "subtotal": "68.30",
    "frete": "12.00",
    "total": "80.30"
  },
  "slots": {
    "acoes": [
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Finalizar compra"
        }
      }
    ]
  }
}
```

**Exemplo: Vazio**

```json
{
  "bloco": "commerce/carrinho",
  "props": {
    "itens": []
  }
}
```

### Cartão de produto (`commerce/cartao-produto`)

Foto, nome e preço de um produto. `href` (opcional) liga ao detalhe. O slot `acoes` recebe botões da página (ex.: "Adicionar").

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `fluida` | booleano | não |  | a foto ocupa toda a largura do cartão (em vez dos 240 px fixos) |
| `href` | texto | não |  |  |
| `idioma` | texto | não |  | idioma do formato do preço |
| `mostraDescricao` | booleano | não |  | mostra a descrição do produto sob o nome |
| `produto` | objeto | sim |  |  |
| `proporcao` | número ≥ 0.2 ≤ 5 | não |  | largura ÷ altura da foto (0,8 = retrato 4:5), com corte |
| `rotuloFoto` | texto ≤ 40 caracteres | não |  | rótulo que sobe sobre a foto no hover (ex.: Ver detalhes) |
| `rotuloIndisponivel` | texto ≤ 40 caracteres | não |  | texto do selo de produto indisponível (padrão "Indisponível") |
| `rotuloLink` | texto ≤ 40 caracteres | não |  | texto do link sob o preço (padrão "Ver detalhes"); vazio esconde o link, e a foto continua levando ao detalhe |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `acoes` | qualquer bloco |  |  |

**Exemplo: Com ação**

```json
{
  "bloco": "commerce/cartao-produto",
  "props": {
    "produto": {
      "id": "p1",
      "nome": "Pão de queijo 500 g",
      "descricao": "Receita tradicional mineira, congelado.",
      "preco": "24.90",
      "precoDe": "29.90",
      "fotoUrl": "exemplos/produto.svg",
      "disponivel": true
    },
    "href": "/produto/p1"
  },
  "slots": {
    "acoes": [
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Adicionar"
        }
      }
    ]
  }
}
```

**Exemplo: Esgotado**

```json
{
  "bloco": "commerce/cartao-produto",
  "props": {
    "produto": {
      "id": "p2",
      "nome": "Bolo de fubá",
      "descricao": "Receita tradicional mineira, congelado.",
      "preco": "18.00",
      "fotoUrl": "exemplos/produto.svg",
      "disponivel": false
    }
  }
}
```

### Detalhe do produto (`commerce/detalhe-produto`)

Página de produto (PDP): foto ao lado do nome, preço, descrição e disponibilidade. O slot `acoes` recebe quantidade e "Adicionar ao carrinho".

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `produto` | objeto | sim |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `acoes` | qualquer bloco |  |  |

**Exemplo: Com ações**

```json
{
  "bloco": "commerce/detalhe-produto",
  "props": {
    "produto": {
      "id": "p1",
      "nome": "Pão de queijo 500 g",
      "descricao": "Receita tradicional mineira, congelado.",
      "preco": "24.90",
      "precoDe": "29.90",
      "fotoUrl": "exemplos/produto.svg",
      "disponivel": true
    }
  },
  "slots": {
    "acoes": [
      {
        "bloco": "entrada/numero",
        "props": {
          "valor": 1,
          "min": 1,
          "rotulo": "Quantidade"
        }
      },
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Adicionar ao carrinho"
        }
      }
    ]
  }
}
```

### Preço (`commerce/preco`)

Preço em reais, com o preço anterior riscado de forma semântica ("de …") quando informado. Aceita texto decimal exato ou número.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `de` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |
| `idioma` | texto | não |  | idioma do formato do preço (pt-BR: R$ 1.234,50; en: R$1,234.50); sem ele, pt-BR |
| `rotuloDe` | texto ≤ 40 caracteres | não |  | palavra antes do preço anterior (padrão "de") |
| `valor` | texto \| número | sim |  | valor em reais: texto decimal exato ("49.90") ou número |

**Exemplo: Simples**

```json
{
  "bloco": "commerce/preco",
  "props": {
    "valor": "49.90"
  }
}
```

**Exemplo: Com preço anterior**

```json
{
  "bloco": "commerce/preco",
  "props": {
    "valor": "49.90",
    "de": "59.90"
  }
}
```

### Resumo do pedido (`commerce/resumo-pedido`)

Subtotal, desconto, frete e total (mesma forma de `carrinho` e `pedido` dos contratos). Desconto e frete só aparecem se forem diferentes de zero.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desconto` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |
| `frete` | texto \| número | não |  | valor em reais: texto decimal exato ("49.90") ou número |
| `idioma` | texto | não |  | idioma do formato do preço (pt-BR: R$ 1.234,50; en: R$1,234.50); sem ele, pt-BR |
| `rotulos` | objeto | não |  | os textos das linhas (subtotal, desconto, frete, total); o template passa os rótulos traduzidos. Padrão em português |
| `subtotal` | texto \| número | sim |  | valor em reais: texto decimal exato ("49.90") ou número |
| `total` | texto \| número | sim |  | valor em reais: texto decimal exato ("49.90") ou número |

**Exemplo: Com frete e desconto**

```json
{
  "bloco": "commerce/resumo-pedido",
  "props": {
    "subtotal": "68.30",
    "desconto": "5.00",
    "frete": "12.00",
    "total": "75.30"
  }
}
```

### Vitrine (`commerce/vitrine`)

Grade de cartões de produto a partir de uma lista (`produtos`, do contrato `catalogo.listarProdutos`). `hrefBase` + id forma o link de cada cartão. Sem produtos, mostra a mensagem de vazio. Para ações em cada cartão, componha `layout/grade` + `repetir` na página.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `colunas` | inteiro ≥ 1 ≤ 6 | não | 3 |  |
| `hrefBase` | texto | não |  | ex.: "/produto/" |
| `produtos` | lista | sim |  |  |

**Exemplo: Três produtos**

```json
{
  "bloco": "commerce/vitrine",
  "props": {
    "produtos": [
      {
        "id": "p1",
        "nome": "Pão de queijo 500 g",
        "descricao": "Receita tradicional mineira, congelado.",
        "preco": "24.90",
        "precoDe": "29.90",
        "fotoUrl": "exemplos/produto.svg",
        "disponivel": true
      },
      {
        "id": "p2",
        "nome": "Bolo de fubá",
        "descricao": "Receita tradicional mineira, congelado.",
        "preco": "18.00",
        "fotoUrl": "exemplos/produto.svg",
        "disponivel": false
      },
      {
        "id": "p3",
        "nome": "Café 250 g",
        "descricao": "Receita tradicional mineira, congelado.",
        "preco": "18.50",
        "fotoUrl": "exemplos/produto.svg",
        "disponivel": true
      }
    ],
    "colunas": 3,
    "hrefBase": "/produto/"
  }
}
```

**Exemplo: Vazia**

```json
{
  "bloco": "commerce/vitrine",
  "props": {
    "produtos": []
  }
}
```

## computacao

### Canvas de kernel (`computacao/canvas-gl`)

Pinta, num canvas, o resultado de um kernel de computação (saídas r, g, b e opcional a, de 0 a 1; `x` e `y` pela `larguraDe`). Usa WebGL2 e cai para wasm e depois para o interpretador; sem JavaScript fica o texto alternativo. O artefato do kernel é servido em /kernels/<id>.json e o carregador é `@polaris/computacao/cliente`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alt` | texto | sim |  |  |
| `altura` | inteiro ≥ 1 ≤ 2048 | não | 300 |  |
| `entradas` | objeto | não |  | valores das entradas escalares do kernel (número ou booleano) |
| `kernel` | texto | sim |  | id do nó kernel (o artefato é servido em /kernels/<id>.json) |
| `largura` | inteiro ≥ 1 ≤ 2048 | não | 300 |  |

**Exemplo: Gradiente**

```json
{
  "bloco": "computacao/canvas-gl",
  "props": {
    "kernel": "gradiente",
    "largura": 64,
    "altura": 64,
    "alt": "Gradiente vermelho e verde",
    "entradas": {
      "w": 64
    }
  }
}
```

## core

### Slot (`core/slot`)

Ponto de inserção dentro do modelo de um bloco composto: o conteúdo que a página põe naquele slot do bloco aparece aqui. Só faz sentido dentro de `modelo`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `nome` | texto | sim |  |  |

## entrada

### Área de texto (`entrada/area`)

Texto de várias linhas, controlado pelo estado como o campo de texto: `valor` vem do estado e `aoMudar` recebe o texto inteiro.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
| `linhas` | inteiro ≥ 1 ≤ 40 | não | 4 |  |
| `placeholder` | texto | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `valor` | texto | não |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoMudar` | texto |

**Exemplo: Comentário**

```json
{
  "bloco": "entrada/area",
  "props": {
    "valor": "",
    "rotulo": "Comentário",
    "placeholder": "Escreva aqui",
    "linhas": 3
  }
}
```

### Arquivo (`entrada/arquivo`)

Seletor de UM arquivo. `aceita` filtra o seletor; `tamanhoMax` (bytes, padrão 2 MB) recusa antes de ler. `aoEscolher` roda só com arquivo que serve e recebe `{ nome, tipo, tamanho, dados }` (bytes em base64); `aoRecusar` roda só quando não serve (nenhum arquivo ou acima de `tamanhoMax`) e recebe `{ erro }`, sem ler o arquivo. O servidor deve revalidar tudo: o tipo declarado aqui não vale nada.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `aceita` | texto ≤ 200 caracteres | não |  | tipos aceitos pelo seletor (atributo accept), ex.: image/png,image/jpeg |
| `desabilitado` | booleano | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `tamanhoMax` | inteiro ≥ 1024 ≤ 8388608 | não | 2097152 | bytes; acima disso o evento traz `erro` e o arquivo nem é lido |

**Eventos**

| Evento | Payload |
|---|---|
| `aoEscolher` | json |
| `aoRecusar` | json |

**Exemplo: Imagens**

```json
{
  "bloco": "entrada/arquivo",
  "props": {
    "rotulo": "Escolha uma imagem",
    "aceita": "image/png,image/jpeg,image/gif,image/webp"
  }
}
```

### Campo de busca (`entrada/busca`)

Campo `type="search"` com nome acessível (`rotulo`, padrão "Buscar"), `nome` do parâmetro (padrão `q`), `placeholder` e `valor` inicial (até 200 caracteres) e `lista` (id de um `form/sugestoes` da página, com as opções que o navegador oferece ao digitar). Vai dentro de um `form/busca`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `lista` | texto ≤ 64 caracteres | não |  | id de um `form/sugestoes` da página: o navegador oferece as opções enquanto se digita |
| `nome` | texto ≤ 31 caracteres | não |  | nome do parâmetro na URL (padrão q) |
| `placeholder` | texto ≤ 100 caracteres | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `valor` | texto ≤ 200 caracteres | não |  | texto inicial (ex.: o termo buscado, `{consulta.q}`) |

**Exemplo: Com termo**

```json
{
  "bloco": "entrada/busca",
  "props": {
    "valor": "café",
    "placeholder": "Buscar"
  }
}
```

### Caixa de seleção (`entrada/caixa`)

Checkbox controlado: `marcado` vem do estado e `aoMudar` recebe um booleano.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
| `marcado` | booleano | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |

**Eventos**

| Evento | Payload |
|---|---|
| `aoMudar` | booleano |

**Exemplo: Marcada**

```json
{
  "bloco": "entrada/caixa",
  "props": {
    "marcado": true,
    "rotulo": "Aceito os termos"
  }
}
```

**Exemplo: Desabilitada**

```json
{
  "bloco": "entrada/caixa",
  "props": {
    "marcado": false,
    "rotulo": "Opção indisponível",
    "desabilitado": true
  }
}
```

### Campo numérico (`entrada/numero`)

Campo `number` com `min`, `max` e `passo`. `aoMudar` recebe um número, ou `null` se o campo estiver vazio.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
| `max` | número | não |  |  |
| `min` | número | não |  |  |
| `passo` | número | não |  |  |
| `placeholder` | texto | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `valor` | número \| texto | não |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoMudar` | decimal |

**Exemplo: Quantidade**

```json
{
  "bloco": "entrada/numero",
  "props": {
    "valor": 2,
    "rotulo": "Quantidade",
    "min": 1,
    "max": 10,
    "passo": 1
  }
}
```

### Opção do seletor (`entrada/opcao`)

Uma opção de `entrada/selecao`: `valor` (o que o seletor devolve) e `texto` (o que se lê).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `selecionada` | booleano | não |  | a opção escolhida (marque a que combina com `valor` do seletor) |
| `texto` | texto | sim |  |  |
| `valor` | texto | sim |  |  |

**Exemplo: Opção**

```json
{
  "bloco": "entrada/opcao",
  "props": {
    "valor": "a",
    "texto": "Opção A"
  }
}
```

### Seletor (`entrada/selecao`)

Lista suspensa (`select` nativo, acessível e sem JavaScript próprio): as opções são os filhos (`entrada/opcao`); `valor` é o escolhido e `aoMudar` recebe o valor novo. Marque `selecionada` na opção que combina com `valor` (é o que o servidor escreve). Dê um `rotulo` ou ligue um `texto/rotulo` por `para`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `valor` | texto | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoMudar` | texto |

**Exemplo: Ordenar**

```json
{
  "bloco": "entrada/selecao",
  "props": {
    "rotulo": "Ordenar por",
    "valor": "preco"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "entrada/opcao",
        "props": {
          "valor": "destaque",
          "texto": "Destaques"
        }
      },
      {
        "bloco": "entrada/opcao",
        "props": {
          "valor": "preco",
          "texto": "Menor preço",
          "selecionada": true
        }
      }
    ]
  }
}
```

### Campo de texto (`entrada/texto`)

Campo controlado pelo estado: `valor` vem do estado e `aoMudar` recebe o texto digitado (compatível com IME).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
| `lista` | texto | não |  | id de um `form/sugestoes` da página: o navegador oferece as opções ao digitar (a lista de valores disponíveis) |
| `placeholder` | texto | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `valor` | texto | não |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoMudar` | texto |

**Exemplo: Com placeholder**

```json
{
  "bloco": "entrada/texto",
  "props": {
    "valor": "",
    "rotulo": "Buscar produtos",
    "placeholder": "Buscar produtos"
  }
}
```

**Exemplo: Desabilitado**

```json
{
  "bloco": "entrada/texto",
  "props": {
    "valor": "somente leitura",
    "rotulo": "Campo somente leitura",
    "desabilitado": true
  }
}
```

## feedback

### Alerta (`feedback/alerta`)

Mensagem em destaque (`role="alert"`: leitores de tela anunciam). `tom` define a cor da borda.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `tom` | "neutro" \| "sucesso" \| "alerta" \| "erro" | não | "neutro" |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Aviso**

```json
{
  "bloco": "feedback/alerta",
  "props": {
    "tom": "alerta"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Estoque baixo: restam 3 unidades."
        }
      }
    ]
  }
}
```

### Selo (`feedback/selo`)

Etiqueta curta de estado. `tom`: neutro, sucesso, alerta ou erro (a cor vem do tema, e o contraste é auditado).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto | sim |  |  |
| `tom` | "neutro" \| "sucesso" \| "alerta" \| "erro" | não | "neutro" |  |

**Exemplo: Sucesso**

```json
{
  "bloco": "feedback/selo",
  "props": {
    "texto": "Pago",
    "tom": "sucesso"
  }
}
```

**Exemplo: Erro**

```json
{
  "bloco": "feedback/selo",
  "props": {
    "texto": "Recusado",
    "tom": "erro"
  }
}
```

## form

### Formulário de busca (`form/busca`)

Formulário `GET` (`role="search"`) que leva o termo para uma página do PRÓPRIO site (`acao`, padrão `/busca`): funciona sem JavaScript, o termo vai na URL (`?q=…`) e a página de resultados o lê em `consulta.q`. Destino que não é um caminho do site vale o padrão.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `acao` | texto ≤ 300 caracteres | não |  | caminho do PRÓPRIO site que recebe a busca (padrão /busca); outro valor vale o padrão |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Campo e botão**

```json
{
  "bloco": "form/busca",
  "slots": {
    "filhos": [
      {
        "bloco": "entrada/busca",
        "props": {
          "placeholder": "Buscar produtos"
        }
      },
      {
        "bloco": "nav/enviar",
        "props": {
          "texto": "Buscar"
        }
      }
    ]
  }
}
```

### Formulário (`form/formulario`)

Monta um formulário declarativo (`kind: formulario`) com máscaras, validação, mensagens e envio (`docs/formularios.md`). O servidor entrega só o ponto de montagem; o carregador do formulário (a "ilha") busca a definição e desenha os campos no navegador, validando com o mesmo motor do servidor. `aoEnviado` recebe `{ resultado, sucesso }` quando o serviço aceita; `aoErro`, `{ erros }`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `formulario` | texto | sim |  | id do nó `formulario` (do tenant ou da plataforma) |
| `idioma` | texto | não |  | idioma das mensagens (padrão: o do visitante) |
| `valores` | objeto | não |  | valores iniciais por campo (edição); só primitivos e listas deles |

**Eventos**

| Evento | Payload |
|---|---|
| `aoEnviado` | json |
| `aoErro` | json |

**Exemplo: Contato**

```json
{
  "bloco": "form/formulario",
  "props": {
    "formulario": "contato"
  }
}
```

**Exemplo: Edição com valores iniciais**

```json
{
  "bloco": "form/formulario",
  "props": {
    "formulario": "contato",
    "valores": {
      "nome": "Ana",
      "email": "ana@exemplo.com"
    },
    "idioma": "pt-BR"
  }
}
```

### Opção de sugestão (`form/opcao`)

Uma opção (`<option value>`) de um `form/sugestoes`; `valor` é o texto sugerido (até 100 caracteres).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `valor` | texto ≤ 100 caracteres | não |  |  |

**Exemplo: Opção dentro da lista**

```json
{
  "bloco": "form/busca",
  "slots": {
    "filhos": [
      {
        "bloco": "entrada/busca",
        "props": {
          "lista": "opcoes-exemplo",
          "placeholder": "Digite c…"
        }
      },
      {
        "bloco": "form/sugestoes",
        "id": "opcoes-exemplo",
        "slots": {
          "filhos": [
            {
              "bloco": "form/opcao",
              "props": {
                "valor": "Café"
              }
            }
          ]
        }
      },
      {
        "bloco": "nav/enviar",
        "props": {
          "texto": "Buscar"
        }
      }
    ]
  }
}
```

### Sugestões (lista do campo) (`form/sugestoes`)

Lista de opções (`<datalist>`) que um campo oferece enquanto se digita, ligada pelo `id` da instância ao `lista` do `entrada/busca`. Sem JavaScript: o navegador filtra pelo que foi digitado. As opções são fixas na página (`form/opcao`); não vêm do servidor a cada tecla.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Campo com sugestões**

```json
{
  "bloco": "form/busca",
  "slots": {
    "filhos": [
      {
        "bloco": "entrada/busca",
        "props": {
          "lista": "sugestoes-exemplo"
        }
      },
      {
        "bloco": "form/sugestoes",
        "id": "sugestoes-exemplo",
        "slots": {
          "filhos": [
            {
              "bloco": "form/opcao",
              "props": {
                "valor": "Café"
              }
            },
            {
              "bloco": "form/opcao",
              "props": {
                "valor": "Chá"
              }
            }
          ]
        }
      },
      {
        "bloco": "nav/enviar",
        "props": {
          "texto": "Buscar"
        }
      }
    ]
  }
}
```

### Sugestões ao vivo (busca) (`form/sugestoes-ao-vivo`)

Lista de sugestões que aparece sob o campo de busca enquanto se digita, buscadas no servidor (`url`, um caminho do próprio site que devolve JSON, ex.: `/api/loja/destaques`; o cliente acrescenta `busca=<termo>&limite=<n>`). Cada item mostra o `titulo`, a `descricao` e a miniatura (`imagem`, só caminho do próprio site) e leva a `destino?q=<título>`. Vai dentro do `form/busca`, depois do campo. Teclado: setas, Enter e Esc; o campo vira uma caixa de combinação (`combobox`). Precisa de JavaScript; sem ele, a lista fica oculta e a busca normal segue funcionando.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `descricao` | texto ≤ 41 caracteres | não |  |  |
| `destino` | texto ≤ 300 caracteres | não |  | página da escolha (padrão /busca): abre `destino?q=<título>` |
| `imagem` | texto ≤ 41 caracteres | não |  | campo com o caminho da miniatura (só caminhos do próprio site) |
| `limite` | inteiro ≥ 1 ≤ 10 | não |  | quantas sugestões (padrão 6) |
| `nome` | texto ≤ 31 caracteres | não |  | parâmetro do destino (padrão q) |
| `rotulo` | texto ≤ 100 caracteres | não |  |  |
| `titulo` | texto ≤ 41 caracteres | não |  | campo do JSON com o título (padrão titulo) |
| `url` | texto ≤ 300 caracteres | sim |  | caminho do PRÓPRIO site que lista (JSON) as sugestões, ex.: /api/loja/destaques; o cliente acrescenta `busca=<termo>&limite=<n>` |

**Exemplo: Campo com sugestões ao vivo**

```json
{
  "bloco": "form/busca",
  "slots": {
    "filhos": [
      {
        "bloco": "entrada/busca",
        "props": {
          "placeholder": "Buscar"
        }
      },
      {
        "bloco": "form/sugestoes-ao-vivo",
        "props": {
          "url": "/api/loja/destaques",
          "imagem": "imagem"
        }
      },
      {
        "bloco": "nav/enviar",
        "props": {
          "texto": "Buscar"
        }
      }
    ]
  }
}
```

## layout

### Cabeçalho (`layout/cabecalho`)

Faixa do topo da página (`<header>`): ponto de referência para leitores de tela. `fixo` o mantém visível ao rolar.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `centro` | booleano | não | false | o menu fica centralizado entre a marca e as ações |
| `fixo` | booleano | não | false |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Com título e menu**

```json
{
  "bloco": "layout/cabecalho",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/destaque",
        "props": {
          "texto": "Minha loja"
        }
      },
      {
        "bloco": "nav/menu",
        "slots": {
          "filhos": [
            {
              "bloco": "nav/link",
              "props": {
                "href": "/",
                "texto": "Início"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Cartão (`layout/cartao`)

Caixa com borda, fundo de superfície e espaçamento interno, para agrupar um item (uma imagem com seus dados, uma versão, um resumo). Em grade ou em lista, vários cartões ficam alinhados. `papel` e `rotulo` dão nome e papel ARIA ao cartão quando ele é um grupo.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `papel` | "toolbar" \| "group" \| "list" \| "status" | não |  |  |
| `rotulo` | texto ≤ 200 caracteres | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Dois cartões**

```json
{
  "bloco": "layout/grade",
  "props": {
    "colunas": 2,
    "gap": 12
  },
  "slots": {
    "filhos": [
      {
        "bloco": "layout/cartao",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/titulo",
              "props": {
                "texto": "Release 12",
                "nivel": 4
              }
            },
            {
              "bloco": "feedback/selo",
              "props": {
                "texto": "Em produção",
                "tom": "sucesso"
              }
            }
          ]
        }
      },
      {
        "bloco": "layout/cartao",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/titulo",
              "props": {
                "texto": "Release 11",
                "nivel": 4
              }
            },
            {
              "bloco": "texto/pequeno",
              "props": {
                "texto": "Anterior"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Contêiner (largura máxima) (`layout/contido`)

Limita e centraliza o conteúdo: largura máxima (`estreita`, `normal` ou `larga`, definidas pelo tema em `layout.largura`, `layout.larguraEstreita` e `layout.larguraLarga`) e margens laterais. Dentro de uma abertura (`layout/destaque`) ou de uma faixa de fundo, mantém o texto alinhado com o resto da página enquanto o fundo vai de ponta a ponta.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `largura` | "estreita" \| "normal" \| "larga" | não | "normal" | a largura máxima do conteúdo (centrado, com margens): estreita, normal ou larga; os valores vêm do tema (`layout.largura*`) |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Texto no contêiner normal**

```json
{
  "bloco": "layout/contido",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/titulo",
        "props": {
          "texto": "Nossa história",
          "nivel": 2
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "O conteúdo fica centrado, com largura máxima e margens, em telas largas e estreitas."
        }
      }
    ]
  }
}
```

**Exemplo: Contêiner estreito para leitura**

```json
{
  "bloco": "layout/contido",
  "props": {
    "largura": "estreita"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Linhas curtas leem melhor: use a largura estreita em textos longos."
        }
      }
    ]
  }
}
```

### Destaque (`layout/destaque`)

Faixa de destaque (`<section>`): fundo da cor primária do tema (ou `suave`), ou uma `imagem` de fundo com véu escuro (`escurece`) para o texto ler. `alinha`: centro ou esquerda; `altura` mínima em px. O texto e os botões ficam nos filhos; a imagem precisa ser do próprio site (o CSP das páginas só carrega imagens da mesma origem). `capa: true` faz dela uma capa (hero): texto embaixo, sobe por baixo do cabeçalho, foto com zoom lento e entrada do texto (tokens `cabecalho.altura` e `movimento.*`); `zoom: true` faz a foto crescer no hover.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | texto | não |  | centro (padrão) ou esquerda (outro valor vale centro) |
| `altura` | número ≥ 120 ≤ 800 | não | 320 | altura mínima em px |
| `capa` | booleano | não |  | faixa de capa (hero): o texto fica embaixo, a faixa sobe por baixo do cabeçalho; com `altura` 800 ocupa a tela toda (100svh), senão no máximo a tela (token cabecalho.altura), a foto faz um zoom lento e o texto entra (tokens movimento.*) |
| `escurece` | número ≥ 0 ≤ 0.8 | não | 0.45 | véu escuro sobre a imagem, para o texto ler |
| `fundo` | texto | não |  | sem imagem: primaria (padrão) ou suave (outro valor vale primaria) |
| `imagem` | texto ≤ 500 caracteres | não |  | URL segura (mesma origem: o CSP das páginas só carrega imagens do próprio site) |
| `zoom` | booleano | não |  | a foto de fundo cresce e escurece no hover (tokens movimento.zoomFaixa e movimento.zoomFaixaDuracao) |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Fundo do tema**

```json
{
  "bloco": "layout/destaque",
  "props": {
    "altura": 200
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/titulo",
        "props": {
          "texto": "Oferta da semana",
          "nivel": 2
        }
      }
    ]
  }
}
```

**Exemplo: Suave, à esquerda**

```json
{
  "bloco": "layout/destaque",
  "props": {
    "fundo": "suave",
    "alinha": "esquerda",
    "altura": 160
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Entrega grátis acima de R$ 99"
        }
      }
    ]
  }
}
```

### Divisor (`layout/divisor`)

Linha horizontal que separa seções (usa a cor de borda do tema).

**Exemplo: Entre parágrafos**

```json
{
  "bloco": "layout/pilha",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Acima"
        }
      },
      {
        "bloco": "layout/divisor"
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Abaixo"
        }
      }
    ]
  }
}
```

### Espaçador (`layout/espacador`)

Espaço vertical em pixels (padrão 8). Não é lido por leitores de tela.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `tamanho` | número ≥ 0 | não | 8 |  |

**Exemplo: 32 px**

```json
{
  "bloco": "layout/pilha",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Antes"
        }
      },
      {
        "bloco": "layout/espacador",
        "props": {
          "tamanho": 32
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Depois"
        }
      }
    ]
  }
}
```

### Grade (`layout/grade`)

Distribui os filhos em colunas iguais (1 a 12). Padrão: 2 colunas.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | "inicio" \| "centro" \| "fim" \| "esticar" | não |  | alinhamento vertical das células (padrão: esticar) |
| `colunas` | inteiro ≥ 1 ≤ 12 | não | 2 |  |
| `gap` | número ≥ 0 | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Três colunas**

```json
{
  "bloco": "layout/grade",
  "props": {
    "colunas": 3,
    "gap": 12
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "1"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "2"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "3"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "4"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "5"
        }
      }
    ]
  }
}
```

### Lateral (menu lateral) (`layout/lateral`)

Coluna lateral (`<aside>`) do `layout/painel`, com nome acessível em `rotulo` (padrão "Navegação lateral"). Costuma levar um `nav/menu` com links ou botões (`atual` marca o escolhido). Prefira o composto `site/menu-lateral`, que já traz o botão que a recolhe no celular.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Com menu**

```json
{
  "bloco": "layout/lateral",
  "props": {
    "rotulo": "Seções"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "nav/menu",
        "slots": {
          "filhos": [
            {
              "bloco": "nav/link",
              "props": {
                "href": "/",
                "texto": "Início",
                "atual": true
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Linha (`layout/linha`)

Coloca os filhos lado a lado (flex row).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | "inicio" \| "centro" \| "fim" \| "esticar" | não |  |  |
| `cresce` | booleano | não |  | ocupa o espaço que sobra na linha (flex 1, sem estourar) |
| `gap` | número ≥ 0 | não |  |  |
| `largura` | número ≥ 40 ≤ 2000 | não |  | largura fixa em px (dentro de uma linha) |
| `marca` | texto | não |  | gancho de estilo: vira data-marca, que o CSS do tema usa (o cartão de produto usa `cartao-produto`) |
| `papel` | "toolbar" \| "group" \| "list" \| "status" | não |  | papel ARIA do grupo (barra de ferramentas, grupo, lista ou status: região viva que o leitor de tela anuncia ao mudar) |
| `quebra` | booleano | não |  | quebra em várias linhas quando falta espaço (flex-wrap); sem isso a linha pode passar da largura |
| `recorta` | booleano | não |  | corta o que passa da caixa (a foto que cresce no hover, com o token movimento.zoomCartao, fica dentro dela) |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do grupo (aria-label) |
| `solta` | booleano | não |  | zona de soltar: itens com `arrasta` (botões) arrastados para dentro dela chegam em `aoSoltar` como `{ valor, alvo, zona }` (zona: antes, dentro ou depois do item sob o ponteiro); a ilha `@polaris/engine/tela` faz o arrastar |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoSoltar` | json |

**Exemplo: Lado a lado**

```json
{
  "bloco": "layout/linha",
  "props": {
    "gap": 16,
    "alinha": "centro"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "A"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "B"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "C"
        }
      }
    ]
  }
}
```

### Painel (cabeçalho, lateral e conteúdo) (`layout/painel`)

Estrutura de aplicação: uma grade com o cabeçalho (`site/cabecalho`) no topo, o menu lateral (`site/menu-lateral` ou `layout/lateral`) à esquerda e o `layout/principal` à direita; ocupa a altura da janela, a lateral e o conteúdo rolam sozinhos. Até 40 rem de largura vira uma coluna e a lateral fica atrás do botão "Seções".

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Cabeçalho, lateral e conteúdo**

```json
{
  "bloco": "layout/painel",
  "slots": {
    "filhos": [
      {
        "bloco": "layout/cabecalho",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/destaque",
              "props": {
                "texto": "Painel"
              }
            }
          ]
        }
      },
      {
        "bloco": "layout/lateral",
        "props": {
          "rotulo": "Seções"
        },
        "slots": {
          "filhos": [
            {
              "bloco": "nav/menu",
              "slots": {
                "filhos": [
                  {
                    "bloco": "nav/link",
                    "props": {
                      "href": "/",
                      "texto": "Início",
                      "atual": true
                    }
                  },
                  {
                    "bloco": "nav/link",
                    "props": {
                      "href": "/a",
                      "texto": "Relatórios"
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      {
        "bloco": "layout/principal",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/titulo",
              "props": {
                "texto": "Visão geral",
                "nivel": 1
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Pilha (`layout/pilha`)

Empilha os filhos na vertical (flex column). Base de quase toda página. `recorta: true` corta o que passa da caixa (foto que cresce no hover); `marca` dá à caixa um gancho de estilo (`data-marca`) para o CSS do tema.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | "inicio" \| "centro" \| "fim" \| "esticar" | não |  |  |
| `cresce` | booleano | não |  | ocupa o espaço que sobra na linha (flex 1, sem estourar) |
| `gap` | número ≥ 0 | não |  |  |
| `largura` | número ≥ 40 ≤ 2000 | não |  | largura fixa em px (dentro de uma linha) |
| `marca` | texto | não |  | gancho de estilo: vira data-marca, que o CSS do tema usa (o cartão de produto usa `cartao-produto`) |
| `papel` | "toolbar" \| "group" \| "list" \| "status" | não |  | papel ARIA do grupo (barra de ferramentas, grupo, lista ou status: região viva que o leitor de tela anuncia ao mudar) |
| `quebra` | booleano | não |  | quebra em várias linhas quando falta espaço (flex-wrap) |
| `recorta` | booleano | não |  | corta o que passa da caixa (a foto que cresce no hover, com o token movimento.zoomCartao, fica dentro dela) |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do grupo (aria-label) |
| `solta` | booleano | não |  | zona de soltar: itens com `arrasta` (botões) arrastados para dentro dela chegam em `aoSoltar` como `{ valor, alvo, zona }` (zona: antes, dentro ou depois do item sob o ponteiro); a ilha `@polaris/engine/tela` faz o arrastar |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoSoltar` | json |

**Exemplo: Com espaçamento**

```json
{
  "bloco": "layout/pilha",
  "props": {
    "gap": 8
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Primeiro"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Segundo"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Terceiro"
        }
      }
    ]
  }
}
```

**Exemplo: Centralizada**

```json
{
  "bloco": "layout/pilha",
  "props": {
    "gap": 4,
    "alinha": "centro"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Curto"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Um texto bem mais comprido"
        }
      }
    ]
  }
}
```

### Principal (conteúdo) (`layout/principal`)

A área de conteúdo (`<main>`) do `layout/painel`: o ponto de referência "principal" para leitores de tela, com rolagem própria.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Com título**

```json
{
  "bloco": "layout/principal",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/titulo",
        "props": {
          "texto": "Conteúdo",
          "nivel": 1
        }
      }
    ]
  }
}
```

### Rodapé (`layout/rodape`)

Faixa do fim da página (`<footer>`): ponto de referência para leitores de tela, com informações do site (contato, links, aviso legal).

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Com aviso**

```json
{
  "bloco": "layout/rodape",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/pequeno",
        "props": {
          "texto": "© 2026 Minha loja"
        }
      }
    ]
  }
}
```

### Seção recolhível (`layout/secao`)

Grupo de conteúdo com título que abre e fecha (um `<details>` nativo, sem JavaScript): o primeiro filho é o `layout/secao-titulo` (o `<summary>`, com ícone) e o resto é o conteúdo. `aberta` faz a seção começar aberta. Boa para painéis de propriedades e formulários longos.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `aberta` | booleano | não |  | começa aberta (o leitor pode recolher) |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Duas seções**

```json
{
  "bloco": "layout/pilha",
  "props": {
    "gap": 8
  },
  "slots": {
    "filhos": [
      {
        "bloco": "layout/secao",
        "props": {
          "aberta": true
        },
        "slots": {
          "filhos": [
            {
              "bloco": "layout/secao-titulo",
              "props": {
                "texto": "Identificação",
                "icone": "editar"
              }
            },
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Nome e identificador do item."
              }
            }
          ]
        }
      },
      {
        "bloco": "layout/secao",
        "slots": {
          "filhos": [
            {
              "bloco": "layout/secao-titulo",
              "props": {
                "texto": "Avançado",
                "icone": "releases"
              }
            },
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Fechada até alguém abrir."
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Título da seção (`layout/secao-titulo`)

O `<summary>` de uma `layout/secao`: o texto clicável (`texto`) com um ícone opcional (`icone`) e a seta que gira ao abrir. Deve ser o primeiro filho da seção.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `icone` | texto | não |  | ícone da família Grafite antes do texto (nomes em `midia/icone`); aceita um valor de dado; um nome que não existe não pinta nada |
| `texto` | texto ≤ 120 caracteres | não |  |  |

**Exemplo: Título com ícone**

```json
{
  "bloco": "layout/secao",
  "props": {
    "aberta": true
  },
  "slots": {
    "filhos": [
      {
        "bloco": "layout/secao-titulo",
        "props": {
          "texto": "Aparência",
          "icone": "layout-destaque"
        }
      },
      {
        "bloco": "texto/pequeno",
        "props": {
          "texto": "Conteúdo da seção"
        }
      }
    ]
  }
}
```

## lista

### Item de lista (`lista/item`)

Um item de `lista/lista`; aceita qualquer bloco dentro.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Dentro de uma lista**

```json
{
  "bloco": "lista/lista",
  "slots": {
    "filhos": [
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Um item"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Lista (`lista/lista`)

Lista de itens; `ordenada` numera. Só aceita `lista/item`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `ordenada` | booleano | não | false |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | lista/item |  |  |

**Exemplo: Com marcadores**

```json
{
  "bloco": "lista/lista",
  "slots": {
    "filhos": [
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Pão"
              }
            }
          ]
        }
      },
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Café"
              }
            }
          ]
        }
      },
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Suco"
              }
            }
          ]
        }
      }
    ]
  }
}
```

**Exemplo: Numerada**

```json
{
  "bloco": "lista/lista",
  "props": {
    "ordenada": true
  },
  "slots": {
    "filhos": [
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Separar"
              }
            }
          ]
        }
      },
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Embalar"
              }
            }
          ]
        }
      },
      {
        "bloco": "lista/item",
        "slots": {
          "filhos": [
            {
              "bloco": "texto/paragrafo",
              "props": {
                "texto": "Enviar"
              }
            }
          ]
        }
      }
    ]
  }
}
```

## midia

### Ícone (`midia/icone`)

Ícone da família Grafite (60: um por bloco e por ação do Studio; grade de 24 px, traço de 1,75 px). `nome` escolhe o ícone; `tamanho` (8 a 96 px) ou, sem ele, 1,25 em (acompanha o texto); `acento` pinta o detalhe na cor de destaque do tema. Sem `rotulo` o ícone é decorativo (`aria-hidden`); com `rotulo` vira uma imagem com nome acessível. A cor é a do texto ao redor (`currentColor`). É feito por CSS (máscara), sem JavaScript e sem pedido de rede. Botões e links aceitam `icone` e põem o ícone antes do texto.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `acento` | booleano | não |  | o detalhe de acento na cor de destaque do tema |
| `nome` | "layout-pilha" \| "layout-linha" \| "layout-grade" \| "layout-painel" \| "layout-lateral" \| "layout-principal" \| "layout-cabecalho" \| "layout-rodape" \| "layout-destaque" \| "layout-divisor" \| "layout-espacador" \| "texto-titulo" \| "texto-paragrafo" \| "texto-pequeno" \| "texto-codigo" \| "texto-rotulo" \| "texto-destaque" \| "nav-link" \| "nav-botao" \| "nav-menu" \| "nav-submenu" \| "nav-alternador" \| "nav-enviar" \| "form-busca" \| "form-formulario" \| "form-sugestoes-ao-vivo" \| "form-opcao" \| "entrada-texto" \| "entrada-numero" \| "entrada-caixa" \| "entrada-area" \| "entrada-arquivo" \| "entrada-busca" \| "midia-imagem" \| "midia-quadro" \| "computacao-canvas-gl" \| "lista-lista" \| "tabela-tabela" \| "feedback-selo" \| "feedback-alerta" \| "cartaz" \| "salvar" \| "desfazer" \| "refazer" \| "publicar" \| "imagens" \| "diagramas" \| "releases" \| "editar" \| "apagar" \| "mais" \| "fechar" \| "chevron" \| "previa" \| "historico" \| "comentarios" \| "usuario" \| "entrar" \| "sair" \| "tema-escuro" \| "sacola" \| "coracao" | sim |  | o ícone (60 na família Grafite: `layout-pilha`, `salvar`, `publicar`…) |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível; sem ele o ícone é decorativo (aria-hidden) |
| `tamanho` | número ≥ 8 ≤ 96 | não |  | lado em px (padrão 1,25 em, acompanha o texto) |

**Exemplo: Ícones em linha**

```json
{
  "bloco": "layout/linha",
  "props": {
    "gap": 12
  },
  "slots": {
    "filhos": [
      {
        "bloco": "midia/icone",
        "props": {
          "nome": "salvar",
          "tamanho": 24
        }
      },
      {
        "bloco": "midia/icone",
        "props": {
          "nome": "publicar",
          "tamanho": 24,
          "acento": true
        }
      },
      {
        "bloco": "midia/icone",
        "props": {
          "nome": "feedback-alerta",
          "tamanho": 24,
          "rotulo": "Atenção"
        }
      },
      {
        "bloco": "texto/paragrafo",
        "props": {
          "texto": "Ícones de 24 px"
        }
      }
    ]
  }
}
```

**Exemplo: No botão e no link**

```json
{
  "bloco": "layout/linha",
  "props": {
    "gap": 12
  },
  "slots": {
    "filhos": [
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Salvar",
          "icone": "salvar"
        }
      },
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Desfazer",
          "icone": "desfazer",
          "variante": "secundario"
        }
      },
      {
        "bloco": "nav/link",
        "props": {
          "href": "/entrar",
          "texto": "Entrar",
          "icone": "entrar"
        }
      }
    ]
  }
}
```

### Imagem (`midia/imagem`)

Imagem carregada sob demanda. Só aceita URLs seguras (http, https ou relativas); outras somem. Se `src` é uma imagem hospedada pela plataforma (`/_polaris/img/<hash>.png|jpg|webp`), e há `tamanhos` ou `largura`, ganha `srcset` automático com as versões de 160, 480, 960 e 1920 px e `sizes` (`tamanhos`, ou "até `largura` px"): o navegador baixa só a versão que cabe na tela. Sem nenhum dos dois, não há como saber o espaço da imagem e ela segue só com `src`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alt` | texto | não |  |  |
| `altura` | número ≥ 1 | não |  |  |
| `fluida` | booleano | não |  | ocupa toda a largura do contêiner (a altura segue a proporção da foto) |
| `largura` | número ≥ 1 | não |  |  |
| `proporcao` | número ≥ 0.2 ≤ 5 | não |  | largura ÷ altura (0,8 = retrato 4:5): a imagem preenche a largura e é cortada para essa proporção (object-fit: cover) |
| `src` | texto | sim |  |  |
| `tamanhos` | texto ≤ 200 caracteres | não |  |  |

**Exemplo: Com tamanho**

```json
{
  "bloco": "midia/imagem",
  "props": {
    "src": "exemplos/produto.svg",
    "alt": "Foto do produto",
    "largura": 120,
    "altura": 80
  }
}
```

### Quadro (`midia/quadro`)

Exibe um documento HTML num iframe **sempre** isolado (`sandbox` vazio: sem scripts, sem formulários, sem navegação, origem opaca), e nenhuma prop altera isso. Serve para pré-visualizações.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `altura` | inteiro ≥ 40 ≤ 4000 | não | 320 |  |
| `html` | texto ≤ 262144 caracteres | sim |  | documento HTML completo a exibir |
| `titulo` | texto ≤ 200 caracteres | sim |  | nome acessível do quadro (obrigatório) |

**Exemplo: Documento simples**

```json
{
  "bloco": "midia/quadro",
  "props": {
    "titulo": "Pré-visualização",
    "html": "<!doctype html><p>Olá do quadro</p>",
    "altura": 120
  }
}
```

### Tela de edição (`midia/tela`)

Moldura de proporção fixa (`proporcao`, largura ÷ altura) que mostra os filhos (uma prévia) e, por cima, as `caixas` que o usuário **arrasta e redimensiona** com o mouse, o toque ou o teclado (setas movem, Alt e setas redimensionam). Cada caixa é `{ id, rotulo, topo, esquerda, largura, altura, rotacao?, atual? }` em frações da moldura; `passo` é a grade de encaixe. Eventos: `aoMover` (`{ id, topo, esquerda, largura, altura }`, ao soltar), `aoSelecionar` (`{ id }`, ao apertar) e `aoSoltar` (`{ valor, topo, esquerda }`, ao soltar sobre a tela um botão com `arrasta`). O comportamento vem da ilha `@polaris/engine/tela`, que o hospedeiro ativa; sem ela é só a moldura.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `caixas` | lista | não |  | as caixas desenhadas por cima dos filhos, que o usuário arrasta e redimensiona (frações da moldura) |
| `passo` | número ≥ 0.001 ≤ 0.1 | não | 0.005 | a grade de encaixe do arrastar (fração da moldura) |
| `proporcao` | número ≤ 20 | não |  | largura ÷ altura da moldura (a prévia de uma peça A4 em pé é 0,7071) |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Eventos**

| Evento | Payload |
|---|---|
| `aoMover` | json |
| `aoSelecionar` | json |
| `aoSoltar` | json |

**Exemplo: Peça com duas caixas**

```json
{
  "bloco": "midia/tela",
  "props": {
    "proporcao": 0.7071,
    "caixas": [
      {
        "id": "titulo",
        "rotulo": "Título",
        "topo": 0.08,
        "esquerda": 0.1,
        "largura": 0.8,
        "altura": 0.2,
        "atual": true
      },
      {
        "id": "preco",
        "rotulo": "Preço",
        "topo": 0.4,
        "esquerda": 0.1,
        "largura": 0.8,
        "altura": 0.3
      }
    ]
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/pequeno",
        "props": {
          "texto": "a prévia da peça entra aqui"
        }
      }
    ]
  }
}
```

## nav

### Alternador (abre e fecha sem JavaScript) (`nav/alternador`)

Caixa de marcar com `role="switch"` e nome acessível (`rotulo`, padrão "Abrir o menu") que o CSS usa para mostrar ou esconder o que vem depois (`input:checked ~ …`): é a base do menu recolhível. Precisa de um `id` na instância e de um `texto/rotulo` com `para` apontando para ele (o clique no rótulo marca a caixa). Sem estado nem evento no runtime.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |

**Exemplo: Com rótulo**

```json
{
  "bloco": "layout/pilha",
  "slots": {
    "filhos": [
      {
        "bloco": "nav/alternador",
        "id": "alt-exemplo",
        "props": {
          "rotulo": "Abrir o menu"
        }
      },
      {
        "bloco": "texto/rotulo",
        "props": {
          "texto": "Menu",
          "para": "alt-exemplo"
        }
      }
    ]
  }
}
```

### Botão (`nav/botao`)

Botão de ação. `aoClicar` executa a lista de ações declarada na instância.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alvo` | texto ≤ 120 caracteres | não |  | identifica o que o botão representa (data-alvo; letras, números, _ e -): o hospedeiro usa para realçar o item correspondente |
| `arrasta` | texto ≤ 120 caracteres | não |  | torna o botão arrastável (`draggable`) e leva este valor ao soltar numa `midia/tela` (evento `aoSoltar`); letras, números, _ e - |
| `atual` | booleano | não |  | o item escolhido (aria-current), ex.: no menu lateral |
| `desabilitado` | booleano | não |  |  |
| `expandido` | booleano | não |  | botão que abre/fecha algo: leva aria-expanded (verdadeiro/falso) |
| `icone` | texto | não |  | ícone da família Grafite antes do texto (nomes em `midia/icone`); aceita um valor de dado; um nome que não existe não pinta nada |
| `texto` | texto | sim |  |  |
| `variante` | "primario" \| "secundario" \| "fantasma" | não |  | primario (padrão): cheio na cor primária; secundario: contorno; fantasma: só o texto |

**Eventos**

| Evento | Payload |
|---|---|
| `aoClicar` | — |

**Exemplo: Padrão**

```json
{
  "bloco": "nav/botao",
  "props": {
    "texto": "Comprar"
  }
}
```

**Exemplo: Desabilitado**

```json
{
  "bloco": "nav/botao",
  "props": {
    "texto": "Esgotado",
    "desabilitado": true
  }
}
```

**Exemplo: Secundário e fantasma**

```json
{
  "bloco": "layout/linha",
  "slots": {
    "filhos": [
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Cancelar",
          "variante": "secundario"
        }
      },
      {
        "bloco": "nav/botao",
        "props": {
          "texto": "Mais",
          "variante": "fantasma"
        }
      }
    ]
  }
}
```

### Botão de envio (`nav/enviar`)

Botão `type="submit"` para formulários simples (sem JavaScript e sem evento); o texto padrão é "Enviar".

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto ≤ 60 caracteres | não | "Enviar" |  |

**Exemplo: Padrão**

```json
{
  "bloco": "nav/enviar"
}
```

### Link (`nav/link`)

Link para uma URL segura (javascript:, data: e similares são recusados). Links externos levam `rel="noopener noreferrer"`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `atual` | booleano | não |  | a página atual: o link leva aria-current="page" |
| `botao` | texto ≤ 12 caracteres | não |  | primario ou secundario: o link com aparência de botão |
| `href` | texto | sim |  |  |
| `icone` | texto | não |  | ícone da família Grafite antes do texto (nomes em `midia/icone`); aceita um valor de dado; um nome que não existe não pinta nada |
| `rotulo` | texto ≤ 200 caracteres | não |  | nome acessível do campo (aria-label); obrigatório na prática quando não há um `texto/rotulo` ligado por `para` |
| `soConsulta` | booleano | não |  | o link só muda a consulta da URL (?nome=valor) da MESMA página: o estado ligado a ela (`daConsulta`) muda e a URL acompanha, sem recarregar nem voltar ao topo |
| `texto` | texto | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Externo**

```json
{
  "bloco": "nav/link",
  "props": {
    "href": "https://exemplo.com",
    "texto": "Site do fabricante"
  }
}
```

**Exemplo: Como botão**

```json
{
  "bloco": "nav/link",
  "props": {
    "href": "/produtos",
    "texto": "Ver produtos",
    "botao": "primario"
  }
}
```

**Exemplo: Com blocos dentro**

```json
{
  "bloco": "nav/link",
  "props": {
    "href": "/carrinho"
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/destaque",
        "props": {
          "texto": "Ver carrinho"
        }
      }
    ]
  }
}
```

### Menu (`nav/menu`)

Grupo de links de navegação (`<nav>`), com nome acessível em `rotulo` (padrão "Principal"). Use `atual` no link da página aberta.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `marca` | texto | não |  | gancho de estilo: vira data-marca, que o CSS do tema usa |
| `rotulo` | texto ≤ 80 caracteres | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Dois links**

```json
{
  "bloco": "nav/menu",
  "slots": {
    "filhos": [
      {
        "bloco": "nav/link",
        "props": {
          "href": "/",
          "texto": "Início",
          "atual": true
        }
      },
      {
        "bloco": "nav/link",
        "props": {
          "href": "/sobre",
          "texto": "Sobre"
        }
      }
    ]
  }
}
```

### Submenu (recolhível, sem JavaScript) (`nav/submenu`)

Grupo recolhível de links dentro de um `nav/menu`: um `<details>` nativo que leva um `nav/submenu-titulo` (o `<summary>`, que abre e fecha) seguido dos links. Funciona por teclado (Tab, Enter e Espaço) sem JavaScript; no computador a lista abre como um painel sob o título (onde o navegador suporta `::details-content`; nos outros, abre em linha), e no celular, em linha. Com o roteador do gateway, Esc e o clique fora o fecham.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Com dois links**

```json
{
  "bloco": "nav/menu",
  "slots": {
    "filhos": [
      {
        "bloco": "nav/submenu",
        "slots": {
          "filhos": [
            {
              "bloco": "nav/submenu-titulo",
              "props": {
                "texto": "Produtos"
              }
            },
            {
              "bloco": "nav/link",
              "props": {
                "href": "/cafes",
                "texto": "Cafés"
              }
            },
            {
              "bloco": "nav/link",
              "props": {
                "href": "/cha",
                "texto": "Chás"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Título do submenu (`nav/submenu-titulo`)

O `<summary>` de um `nav/submenu`: o texto clicável que abre e fecha o grupo (`texto`). Deve ser o primeiro filho do submenu.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto ≤ 80 caracteres | não |  |  |

**Exemplo: Título**

```json
{
  "bloco": "nav/submenu",
  "slots": {
    "filhos": [
      {
        "bloco": "nav/submenu-titulo",
        "props": {
          "texto": "Mais"
        }
      },
      {
        "bloco": "nav/link",
        "props": {
          "href": "/sobre",
          "texto": "Sobre"
        }
      }
    ]
  }
}
```

## site

### Abas de navegação (`site/abas`)

Fileira de abas (links) para trocar de categoria ou de visão: `itens` com `texto`, `href` e `atual` (a aba escolhida, `aria-current`). É um `nav` com nome acessível (`rotulo`); rola na horizontal quando não cabe. O visual (caixa alta, aba ativa preenchida) vem dos tokens `abas.*` do tema.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `itens` | lista | sim |  | as abas, na ordem |
| `rotulo` | texto ≤ 80 caracteres | não |  | nome acessível do menu (padrão "Principal") |

**Exemplo: Categorias**

```json
{
  "bloco": "site/abas",
  "props": {
    "rotulo": "Categorias",
    "itens": [
      {
        "texto": "Todas",
        "href": "/produtos",
        "atual": true
      },
      {
        "texto": "Iluminação",
        "href": "/produtos?c=luz"
      },
      {
        "texto": "Cerâmica",
        "href": "/produtos?c=ceramica"
      }
    ]
  }
}
```

### Barra de busca (`site/busca`)

Campo de busca com botão: um formulário `GET` que leva o termo (`?q=…`) a uma página do próprio site (`acao`, padrão `/busca`), que o lê em `consulta.q`. Funciona sem JavaScript. `valor` preenche o campo (use `{consulta.q}` na página de resultados) e `rotulo` dá o nome acessível. Cabe no slot `acoes` do `site/cabecalho`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `acao` | texto ≤ 300 caracteres | não |  | caminho do PRÓPRIO site (padrão /busca) |
| `botao` | texto ≤ 60 caracteres | não | "Buscar" |  |
| `nome` | texto ≤ 31 caracteres | não |  | parâmetro na URL (padrão q) |
| `placeholder` | texto ≤ 100 caracteres | não | "Buscar" |  |
| `rotulo` | texto ≤ 100 caracteres | não | "Buscar" |  |
| `sugestoes` | lista | não |  | termos que o navegador oferece enquanto se digita (lista nativa, sem JavaScript; fixos na página). Uma barra com sugestões por página (o id da lista é fixo) |
| `sugestoesDescricao` | texto ≤ 41 caracteres | não |  |  |
| `sugestoesDestino` | texto ≤ 300 caracteres | não |  | página aberta ao escolher (padrão: a própria `acao`) |
| `sugestoesImagem` | texto ≤ 41 caracteres | não |  | campo com o caminho da miniatura |
| `sugestoesLimite` | inteiro ≥ 1 ≤ 10 | não | 6 |  |
| `sugestoesTitulo` | texto ≤ 41 caracteres | não | "titulo" |  |
| `sugestoesUrl` | texto ≤ 300 caracteres | não |  | sugestões AO VIVO: caminho do próprio site que devolve JSON (ex.: /api/loja/destaques); o cliente busca `busca=<termo>` a cada pausa na digitação. Precisa de JavaScript |
| `valor` | texto ≤ 200 caracteres | não |  |  |

**Exemplo: Padrão**

```json
{
  "bloco": "site/busca",
  "props": {}
}
```

**Exemplo: Com sugestões ao vivo**

```json
{
  "bloco": "site/busca",
  "props": {
    "sugestoesUrl": "/api/loja/destaques",
    "sugestoesImagem": "imagem"
  }
}
```

**Exemplo: Com sugestões**

```json
{
  "bloco": "site/busca",
  "props": {
    "sugestoes": [
      "Café",
      "Cafeteira italiana",
      "Chá verde"
    ]
  }
}
```

**Exemplo: Com termo e outro destino**

```json
{
  "bloco": "site/busca",
  "props": {
    "acao": "/produtos",
    "valor": "café",
    "placeholder": "Buscar produtos",
    "botao": "Procurar"
  }
}
```

### Cabeçalho do site (`site/cabecalho`)

Topo da página: marca (logo e/ou nome, ligada ao início), menu de navegação (`links`, com `atual` na página aberta, e `grupos`: submenus recolhíveis, sem JavaScript) e o slot `acoes` à direita (ex.: botão de entrar ou carrinho). `fixo` o mantém no topo ao rolar. No celular o menu e as ações ficam atrás de um botão "Menu" (`nav/alternador`, sem JavaScript; `menuRecolhivel: false` desliga). Usa `<header>` e `<nav>` (pontos de referência para leitores de tela) e só variáveis do tema. Uma por página (o `id` do alternador é fixo).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `fixo` | booleano | não | false |  |
| `grupos` | lista | não |  | submenus: cada grupo (`titulo` e `links`) é um item recolhível que abre uma lista de links, depois dos `links`; um nível só |
| `gruposAntes` | booleano | não | false | os submenus (`grupos`) vêm antes dos `links` no menu |
| `href` | texto ≤ 500 caracteres | não | "/" | para onde a marca leva |
| `links` | lista | não |  | o menu |
| `logo` | texto ≤ 500 caracteres | não |  | URL segura da imagem da marca |
| `menuCentro` | booleano | não | false | centraliza o menu entre a marca e as ações |
| `menuRecolhivel` | booleano | não | true | no celular (até 40 rem de largura) o menu e as ações ficam atrás de um botão "Menu", sem JavaScript; false mantém tudo à vista |
| `rotuloAlternador` | texto ≤ 60 caracteres | não | "Abrir o menu" |  |
| `rotuloMenu` | texto ≤ 80 caracteres | não | "Principal" |  |
| `titulo` | texto ≤ 80 caracteres | não |  | nome da marca |
| `tituloNivel` | inteiro ≥ 1 ≤ 6 | não |  | faz do nome da marca um título (h1…h6) em vez de texto em destaque: use 1 em aplicações cujo painel não tem outro h1 |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `acoes` | qualquer bloco |  |  |

**Exemplo: Marca e menu**

```json
{
  "bloco": "site/cabecalho",
  "props": {
    "titulo": "Loja Demo",
    "links": [
      {
        "texto": "Início",
        "href": "/",
        "atual": true
      },
      {
        "texto": "Produtos",
        "href": "/produtos"
      },
      {
        "texto": "Contato",
        "href": "/contato"
      }
    ]
  }
}
```

**Exemplo: Com ação e fixo**

```json
{
  "bloco": "site/cabecalho",
  "props": {
    "titulo": "Loja Demo",
    "fixo": true,
    "links": [
      {
        "texto": "Início",
        "href": "/"
      }
    ]
  },
  "slots": {
    "acoes": [
      {
        "bloco": "nav/link",
        "props": {
          "href": "/entrar",
          "texto": "Entrar"
        }
      }
    ]
  }
}
```

### Hero (banner de destaque) (`site/hero`)

Faixa de abertura da página: `titulo` (o `<h1>`), `subtitulo`, até dois botões de ação (`cta` primário e `cta2` secundário) e o slot `extra`. O fundo é a cor primária do tema (ou `suave`), ou uma `imagem` do próprio site com véu escuro (`escurece`) para o texto ler. `alinha`: centro (padrão) ou esquerda. O título deve ser o único `<h1>` da página.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | texto ≤ 10 caracteres | não |  | centro ou esquerda |
| `altura` | número ≥ 120 ≤ 800 | não | 320 |  |
| `cta` | objeto | não |  |  |
| `cta2` | objeto | não |  |  |
| `escurece` | número ≥ 0 ≤ 0.8 | não | 0.45 |  |
| `fundo` | texto ≤ 10 caracteres | não |  | sem imagem: primaria ou suave |
| `imagem` | texto ≤ 500 caracteres | não |  | URL segura da MESMA origem (o CSP das páginas só carrega imagens do próprio site) |
| `subtitulo` | texto ≤ 300 caracteres | não |  |  |
| `titulo` | texto ≤ 140 caracteres | sim |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `extra` | qualquer bloco |  |  |

**Exemplo: Título, subtítulo e dois botões**

```json
{
  "bloco": "site/hero",
  "props": {
    "titulo": "Tudo para a sua casa",
    "subtitulo": "Ofertas novas toda semana, com entrega rápida.",
    "cta": {
      "texto": "Ver ofertas",
      "href": "/produtos"
    },
    "cta2": {
      "texto": "Falar conosco",
      "href": "/contato"
    }
  }
}
```

**Exemplo: À esquerda, fundo suave**

```json
{
  "bloco": "site/hero",
  "props": {
    "titulo": "Frete grátis",
    "subtitulo": "Em compras acima de R$ 99.",
    "alinha": "esquerda",
    "fundo": "suave",
    "altura": 200,
    "cta": {
      "texto": "Aproveitar",
      "href": "/produtos"
    }
  }
}
```

### Menu lateral (`site/menu-lateral`)

Coluna lateral de navegação para aplicações e painéis (use dentro de um `layout/painel`, ao lado do `layout/principal`): grupos de links com título (`grupos`, `atual` marca a página aberta) e os slots `topo` (antes do menu, ex.: marca ou busca) e `filhos` (depois: qualquer conteúdo, como botões de ação num `nav/menu`). No celular a lateral fica atrás de um botão ("Seções", `rotuloAlternador`), sem JavaScript. Usa `<aside>` e `<nav>` com nome acessível e só variáveis do tema. Uma por página (o `id` do alternador é fixo).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `grupos` | lista | não |  | grupos de links: `titulo` e `links` (`texto`, `href`, `atual`) |
| `rotulo` | texto ≤ 80 caracteres | não | "Navegação lateral" | nome acessível da lateral |
| `rotuloAlternador` | texto ≤ 60 caracteres | não | "Abrir as seções" |  |
| `rotuloMenu` | texto ≤ 80 caracteres | não | "Seções" | nome acessível do menu de links |
| `textoAlternador` | texto ≤ 40 caracteres | não | "Seções" | o texto do botão no celular |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |
| `topo` | qualquer bloco |  |  |

**Exemplo: Grupos de links**

```json
{
  "bloco": "site/menu-lateral",
  "props": {
    "grupos": [
      {
        "titulo": "Conta",
        "links": [
          {
            "texto": "Perfil",
            "href": "/perfil",
            "atual": true
          },
          {
            "texto": "Segurança",
            "href": "/seguranca"
          }
        ]
      },
      {
        "titulo": "Loja",
        "links": [
          {
            "texto": "Pedidos",
            "href": "/pedidos"
          }
        ]
      }
    ]
  }
}
```

### Rodapé do site (`site/rodape`)

Fim da página: colunas de links (cada uma com título e um menu próprio, com nome acessível), uma linha de contato/endereço, o aviso legal (`copyright`) e o slot `extra` para o que a página quiser (ex.: um formulário de assinatura). Usa `<footer>` e `<nav>` e só variáveis do tema.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `colunas` | lista | não |  | grupos de links |
| `contato` | texto ≤ 300 caracteres | não |  | telefone, e-mail ou endereço, numa linha |
| `copyright` | texto ≤ 300 caracteres | não |  | aviso legal, ex.: © 2026 Minha loja |
| `descricao` | texto ≤ 300 caracteres | não |  | frase curta sob a marca |
| `marca` | texto ≤ 80 caracteres | não |  | nome da marca, em destaque à esquerda das colunas |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `extra` | qualquer bloco |  |  |

**Exemplo: Colunas e aviso**

```json
{
  "bloco": "site/rodape",
  "props": {
    "colunas": [
      {
        "titulo": "Loja",
        "links": [
          {
            "texto": "Produtos",
            "href": "/produtos"
          },
          {
            "texto": "Contato",
            "href": "/contato"
          }
        ]
      },
      {
        "titulo": "Ajuda",
        "links": [
          {
            "texto": "Sobre",
            "href": "/sobre"
          }
        ]
      }
    ],
    "contato": "contato@exemplo.com · (11) 4000-0000",
    "copyright": "© 2026 Minha loja"
  }
}
```

**Exemplo: Só o aviso, com extra**

```json
{
  "bloco": "site/rodape",
  "props": {
    "copyright": "© 2026 Minha loja"
  },
  "slots": {
    "extra": [
      {
        "bloco": "nav/link",
        "props": {
          "href": "/termos",
          "texto": "Termos de uso"
        }
      }
    ]
  }
}
```

## tabela

### Cabeçalho de tabela (`tabela/cabecalho`)

Grupo `thead`: aceita só `tabela/linha`.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | tabela/linha |  |  |

**Exemplo: Colunas**

```json
{
  "bloco": "tabela/tabela",
  "slots": {
    "filhos": [
      {
        "bloco": "tabela/cabecalho",
        "slots": {
          "filhos": [
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "A",
                      "cabecalho": true
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "B",
                      "cabecalho": true
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Célula de tabela (`tabela/celula`)

`td` (ou `th` com `cabecalho`). Use `texto` para texto simples ou `filhos` para blocos; `colunas` e `linhas` mesclam.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `cabecalho` | booleano | não | false |  |
| `colunas` | inteiro ≥ 1 ≤ 1000 | não |  |  |
| `linhas` | inteiro ≥ 1 ≤ 65534 | não |  |  |
| `texto` | texto | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Mesclando colunas**

```json
{
  "bloco": "tabela/tabela",
  "slots": {
    "filhos": [
      {
        "bloco": "tabela/corpo",
        "slots": {
          "filhos": [
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "Total",
                      "colunas": 2
                    }
                  }
                ]
              }
            },
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "a"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "b"
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Corpo de tabela (`tabela/corpo`)

Grupo `tbody`: aceita só `tabela/linha`.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | tabela/linha |  |  |

**Exemplo: Linhas**

```json
{
  "bloco": "tabela/tabela",
  "slots": {
    "filhos": [
      {
        "bloco": "tabela/corpo",
        "slots": {
          "filhos": [
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "1"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "2"
                    }
                  }
                ]
              }
            },
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "3"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "4"
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Linha de tabela (`tabela/linha`)

Uma `tr`: aceita só `tabela/celula`.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | tabela/celula |  |  |

**Exemplo: Uma linha**

```json
{
  "bloco": "tabela/tabela",
  "slots": {
    "filhos": [
      {
        "bloco": "tabela/corpo",
        "slots": {
          "filhos": [
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "x"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "y"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "z"
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Tabela (`tabela/tabela`)

Tabela de dados. Estrutura obrigatória: `cabecalho` e/ou `corpo`, com `linha` e `celula`.

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | tabela/cabecalho, tabela/corpo |  |  |

**Exemplo: Pedidos**

```json
{
  "bloco": "tabela/tabela",
  "slots": {
    "filhos": [
      {
        "bloco": "tabela/cabecalho",
        "slots": {
          "filhos": [
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "Item",
                      "cabecalho": true
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "Qtd",
                      "cabecalho": true
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      {
        "bloco": "tabela/corpo",
        "slots": {
          "filhos": [
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "Pão"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "3"
                    }
                  }
                ]
              }
            },
            {
              "bloco": "tabela/linha",
              "slots": {
                "filhos": [
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "Café"
                    }
                  },
                  {
                    "bloco": "tabela/celula",
                    "props": {
                      "texto": "1"
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

## texto

### Código (`texto/codigo`)

Trecho de código ou identificador em fonte monoespaçada.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto | sim |  |  |

**Exemplo: SKU**

```json
{
  "bloco": "texto/codigo",
  "props": {
    "texto": "SKU-00123"
  }
}
```

### Destaque (`texto/destaque`)

Trecho importante em negrito semântico (`strong`).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto | sim |  |  |

**Exemplo: Preço**

```json
{
  "bloco": "texto/destaque",
  "props": {
    "texto": "R$ 49,90"
  }
}
```

### Ênfase (`texto/enfase`)

Ênfase semântica em itálico (`em`). Com `bloco: true` ocupa a linha inteira.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `bloco` | booleano | não |  | a ênfase ocupa a linha inteira (vira uma segunda linha do título) |
| `texto` | texto | sim |  |  |

**Exemplo: Ênfase**

```json
{
  "bloco": "texto/enfase",
  "props": {
    "texto": "beleza serena"
  }
}
```

### Parágrafo (`texto/paragrafo`)

Texto corrido. O conteúdo é sempre escapado (nunca HTML).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto | sim |  |  |

**Exemplo: Texto simples**

```json
{
  "bloco": "texto/paragrafo",
  "props": {
    "texto": "Frete grátis acima de R$ 99."
  }
}
```

**Exemplo: Com marcação (aparece como texto)**

```json
{
  "bloco": "texto/paragrafo",
  "props": {
    "texto": "<b>não vira negrito</b> & continua seguro"
  }
}
```

### Texto pequeno (`texto/pequeno`)

Observações e notas de rodapé, em cor suave.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto | sim |  |  |

**Exemplo: Nota**

```json
{
  "bloco": "texto/pequeno",
  "props": {
    "texto": "Preço válido até domingo."
  }
}
```

### Rótulo (`texto/rotulo`)

Rótulo de campo. `para` liga ao `id` do campo (clicar no rótulo foca o campo).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `para` | texto | não |  |  |
| `texto` | texto | sim |  |  |

**Exemplo: Rótulo de um campo**

```json
{
  "bloco": "layout/pilha",
  "props": {
    "gap": 4
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/rotulo",
        "props": {
          "texto": "Nome",
          "para": "nome"
        }
      },
      {
        "bloco": "entrada/texto",
        "id": "nome",
        "props": {
          "placeholder": "Seu nome"
        }
      }
    ]
  }
}
```

### Sobretítulo (`texto/sobretitulo`)

A linha pequena em caixa alta e letras espaçadas que vem antes de um título ("Coleção em destaque"), na cor primária do tema (ou na do texto, sobre uma foto). É um parágrafo, não um título: o título de verdade continua sendo `texto/titulo`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto ≤ 200 caracteres | sim |  |  |

**Exemplo: Antes de um título**

```json
{
  "bloco": "layout/pilha",
  "slots": {
    "filhos": [
      {
        "bloco": "texto/sobretitulo",
        "props": {
          "texto": "Coleção em destaque"
        }
      },
      {
        "bloco": "texto/titulo",
        "props": {
          "texto": "Iluminação",
          "nivel": 2
        }
      }
    ]
  }
}
```

### Título (`texto/titulo`)

Cabeçalho h1 a h6 conforme `nivel` (padrão 1). `tamanho: "grande"` usa o tamanho maior de seção do tema. Com `texto` vazio (`""`), o título é montado com os filhos (`texto/trecho` e `texto/enfase`: a segunda linha em itálico, por exemplo).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `nivel` | inteiro ≥ 1 ≤ 6 | não | 1 |  |
| `tamanho` | "grande" | não |  | título de seção maior (token tipografia.tamanhoGrande) |
| `texto` | texto | sim |  | o texto do título; vazio ("") faz o título ser montado com os filhos (`texto/trecho`, `texto/enfase`) |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

**Exemplo: Com ênfase em itálico**

```json
{
  "bloco": "texto/titulo",
  "props": {
    "texto": "",
    "nivel": 1
  },
  "slots": {
    "filhos": [
      {
        "bloco": "texto/trecho",
        "props": {
          "texto": "Objetos de"
        }
      },
      {
        "bloco": "texto/enfase",
        "props": {
          "texto": "beleza serena",
          "bloco": true
        }
      }
    ]
  }
}
```

**Exemplo: Nível 2**

```json
{
  "bloco": "texto/titulo",
  "props": {
    "texto": "Mais vendidos",
    "nivel": 2
  }
}
```

### Trecho (`texto/trecho`)

Pedaço de texto em linha (`span`), para montar um título ou um parágrafo com partes diferentes.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `texto` | texto | sim |  |  |

**Exemplo: Trecho**

```json
{
  "bloco": "texto/trecho",
  "props": {
    "texto": "Objetos de"
  }
}
```

