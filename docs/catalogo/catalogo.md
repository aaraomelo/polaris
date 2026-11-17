# Catálogo de blocos

27 blocos. Gerado do registry (`pnpm catalogo`); não edite à mão: a fonte é o nó de cada bloco.

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

**Eventos**

| Evento | Payload |
|---|---|
| `aoMudar` | booleano |

**Exemplo: Marcada**

```json
{
  "bloco": "entrada/caixa",
  "props": {
    "marcado": true
  }
}
```

**Exemplo: Desabilitada**

```json
{
  "bloco": "entrada/caixa",
  "props": {
    "marcado": false,
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

