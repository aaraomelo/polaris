// polaris: formulario contato@1.0.0
export const kind = "formulario";
export const id = "contato";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "contato",
  "kind": "formulario",
  "spec": {
    "acoes": [
      {
        "estilo": "primario",
        "id": "enviar",
        "rotulo": "Enviar mensagem",
        "tipo": "enviar"
      },
      {
        "confirmar": {
          "mensagem": "Apagar tudo o que você digitou?",
          "rotuloCancelar": "Voltar",
          "rotuloConfirmar": "Apagar"
        },
        "estilo": "secundario",
        "id": "limpar",
        "rotulo": "Limpar",
        "tipo": "limpar"
      },
      {
        "acoes": [
          {
            "acao": "navegar",
            "para": "/"
          }
        ],
        "estilo": "link",
        "id": "cancelar",
        "rotulo": "Cancelar",
        "tipo": "cancelar"
      }
    ],
    "campos": [
      {
        "autocompletar": "name",
        "mensagens": {
          "obrigatorio": "Diga como podemos chamar você.",
          "tamanhoMinimo": "O nome precisa de pelo menos {min} letras."
        },
        "nome": "nome",
        "normaliza": [
          "aparar",
          "colapsaEspacos"
        ],
        "obrigatorio": true,
        "rotulo": "Nome completo",
        "tipo": "texto",
        "validacao": {
          "tamanhoMaximo": 120,
          "tamanhoMinimo": 3
        }
      },
      {
        "autocompletar": "email",
        "nome": "email",
        "normaliza": [
          "aparar",
          "minusculas"
        ],
        "obrigatorio": true,
        "rotulo": "E-mail",
        "teclado": "email",
        "tipo": "email"
      },
      {
        "mascara": {
          "enviaComLiterais": false,
          "padrao": [
            "(00) 0000-0000",
            "(00) 00000-0000"
          ],
          "substituto": "_"
        },
        "mensagens": {
          "formato": "Informe o telefone com DDD."
        },
        "nome": "telefone",
        "placeholder": "(11) 99999-0000",
        "rotulo": "Telefone",
        "teclado": "telefone",
        "tipo": "telefone"
      },
      {
        "mascara": {
          "padrao": "000.000.000-00"
        },
        "nome": "cpf",
        "obrigatorioSe": "valores.retorno == true",
        "rotulo": "CPF",
        "se": "valores.retorno == true",
        "tipo": "cpf"
      },
      {
        "nome": "assunto",
        "obrigatorio": true,
        "opcoes": [
          {
            "rotulo": "Dúvida",
            "valor": "duvida"
          },
          {
            "rotulo": "Sobre um pedido",
            "valor": "pedido"
          },
          {
            "rotulo": {
              "en": "Something else",
              "pt-BR": "Outro assunto"
            },
            "valor": "outro"
          }
        ],
        "rotulo": "Assunto",
        "tipo": "escolha"
      },
      {
        "mascara": {
          "maiusculas": true,
          "padrao": "AAA-000000"
        },
        "mensagens": {
          "padrao": "Use o formato ABC-123456."
        },
        "nome": "pedido",
        "obrigatorioSe": "valores.assunto == \"pedido\"",
        "rotulo": "Número do pedido",
        "se": "valores.assunto == \"pedido\"",
        "tipo": "texto",
        "validacao": {
          "padrao": "[A-Z]{3}[0-9]{6}"
        }
      },
      {
        "formato": {
          "agrupaMilhar": true,
          "casasDecimais": 2,
          "moeda": "BRL"
        },
        "nome": "valorCompra",
        "rotulo": "Valor da compra",
        "tipo": "dinheiro",
        "validacao": {
          "maximo": "100000",
          "minimo": "0.01"
        }
      },
      {
        "formato": {
          "formatoData": "dd/MM/yyyy"
        },
        "mensagens": {
          "dataMaxima": "A data não pode ser no futuro."
        },
        "nome": "dataCompra",
        "rotulo": "Data da compra",
        "tipo": "data",
        "validacao": {
          "dataMaxima": "hoje",
          "dataMinima": "hoje-5a"
        }
      },
      {
        "nome": "mensagem",
        "obrigatorio": true,
        "rotulo": "Mensagem",
        "tipo": "textoLongo",
        "validacao": {
          "regras": [
            {
              "expr": "!contem(valor, \"http\")",
              "id": "semLinks",
              "mensagem": "Por segurança, não aceitamos links na mensagem."
            }
          ],
          "tamanhoMaximo": 2000,
          "tamanhoMinimo": 10
        }
      },
      {
        "nome": "retorno",
        "padrao": false,
        "rotulo": "Quero retorno por telefone",
        "tipo": "booleano"
      },
      {
        "mensagens": {
          "obrigatorio": "Precisamos do seu aceite para responder."
        },
        "nome": "aceite",
        "obrigatorio": true,
        "rotulo": "Concordo com o uso dos dados para contato",
        "tipo": "booleano"
      }
    ],
    "descricao": "Respondemos em até 1 dia útil.",
    "envio": {
      "args": {
        "email": "valores.email",
        "mensagem": "valores.mensagem",
        "nome": "valores.nome"
      },
      "erro": {
        "mapeiaCampos": true
      },
      "idempotencia": true,
      "operacao": "criarContato",
      "servico": "loja",
      "sucesso": {
        "acoes": [
          {
            "acao": "navegar",
            "para": "/obrigado"
          }
        ],
        "limpar": true,
        "mensagem": "Recebemos sua mensagem."
      },
      "timeoutMs": 15000
    },
    "idioma": "pt-BR",
    "mensagens": {
      "envio": "Não foi possível enviar agora. Tente de novo em instantes.",
      "formato": "{rotulo} está em um formato inválido.",
      "obrigatorio": "{rotulo} é obrigatório.",
      "sucesso": "Mensagem enviada! Obrigado.",
      "tamanhoMaximo": "{rotulo} aceita até {max} caracteres."
    },
    "secoes": [
      {
        "campos": [
          "nome",
          "email",
          "telefone",
          "cpf"
        ],
        "colunas": 2,
        "id": "quem",
        "titulo": "Quem é você"
      },
      {
        "campos": [
          "assunto",
          "pedido",
          "valorCompra",
          "dataCompra"
        ],
        "id": "sobre",
        "titulo": "Sobre o que"
      },
      {
        "campos": [
          "mensagem",
          "retorno",
          "aceite"
        ],
        "id": "fim"
      }
    ],
    "titulo": "Fale conosco",
    "validacoes": [
      {
        "campos": [
          "telefone",
          "retorno"
        ],
        "id": "retornoComTelefone",
        "mensagem": "Para retorno por telefone, informe o telefone.",
        "quando": "enviar",
        "regra": "!(valores.retorno == true) || tamanho(valores.telefone ?? \"\") > 0"
      }
    ],
    "validar": {
      "focaPrimeiroErro": true,
      "quando": "sair"
    }
  },
  "versao": "1.0.0"
};
