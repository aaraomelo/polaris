# Catálogo de blocos

34 blocos. Gerado do registry (`pnpm catalogo`); não edite à mão: a fonte é o nó de cada bloco.

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
| `href` | texto | não |  |  |
| `produto` | objeto | sim |  |  |

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

### Campo de texto (`entrada/texto`)

Campo controlado pelo estado: `valor` vem do estado e `aoMudar` recebe o texto digitado (compatível com IME).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
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

## layout

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

### Linha (`layout/linha`)

Coloca os filhos lado a lado (flex row).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | "inicio" \| "centro" \| "fim" \| "esticar" | não |  |  |
| `gap` | número ≥ 0 | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

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

### Pilha (`layout/pilha`)

Empilha os filhos na vertical (flex column). Base de quase toda página.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alinha` | "inicio" \| "centro" \| "fim" \| "esticar" | não |  |  |
| `gap` | número ≥ 0 | não |  |  |

**Slots**

| Slot | Aceita | Mín. | Máx. |
|---|---|---|---|
| `filhos` | qualquer bloco |  |  |

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

### Imagem (`midia/imagem`)

Imagem carregada sob demanda. Só aceita URLs seguras (http, https ou relativas); outras somem.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `alt` | texto | não |  |  |
| `altura` | número ≥ 1 | não |  |  |
| `largura` | número ≥ 1 | não |  |  |
| `src` | texto | sim |  |  |

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

## nav

### Botão (`nav/botao`)

Botão de ação. `aoClicar` executa a lista de ações declarada na instância.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `desabilitado` | booleano | não |  |  |
| `texto` | texto | sim |  |  |

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

### Link (`nav/link`)

Link para uma URL segura (javascript:, data: e similares são recusados). Links externos levam `rel="noopener noreferrer"`.

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `href` | texto | sim |  |  |
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

### Título (`texto/titulo`)

Cabeçalho h1 a h6 conforme `nivel` (padrão 1).

**Props**

| Prop | Tipo | Obrig. | Padrão | Descrição |
|---|---|---|---|---|
| `nivel` | inteiro ≥ 1 ≤ 6 | não | 1 |  |
| `texto` | texto | sim |  |  |

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

