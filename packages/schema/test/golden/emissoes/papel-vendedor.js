// polaris: papel vendedor@1.0.0
export const kind = "papel";
export const id = "vendedor";
export const versao = "1.0.0";
export default {
  "id": "vendedor",
  "kind": "papel",
  "spec": {
    "descricao": "Atende o balcão: lê o catálogo e gerencia só os próprios pedidos.",
    "herda": [
      "leitor"
    ],
    "regras": [
      {
        "acoes": [
          "listar",
          "obter"
        ],
        "sujeitos": [
          "loja.produto"
        ]
      },
      {
        "acoes": [
          "manage"
        ],
        "onde": {
          "criadoPor": "$usuario"
        },
        "sujeitos": [
          "loja.pedido"
        ]
      },
      {
        "acoes": [
          "remover"
        ],
        "negar": true,
        "sujeitos": [
          "all"
        ]
      },
      {
        "acoes": [
          "atualizar"
        ],
        "campos": [
          "telefone",
          "email"
        ],
        "sujeitos": [
          "loja.cliente"
        ]
      }
    ]
  },
  "versao": "1.0.0"
};
