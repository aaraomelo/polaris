// polaris: cartaz etiqueta-codigos@1.0.0
export const kind = "cartaz";
export const id = "etiqueta-codigos";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "etiqueta-codigos",
  "kind": "cartaz",
  "spec": {
    "dados": {
      "link": {
        "tipo": "texto"
      },
      "produto": {
        "tipo": "json"
      }
    },
    "elementos": [
      {
        "alinhaH": "esquerda",
        "alinhaV": "meio",
        "caixa": {
          "altura": 0.25,
          "esquerda": 0.05,
          "largura": 0.9,
          "topo": 0.05
        },
        "id": "nome",
        "texto": "{produto.nome}",
        "tipo": "texto"
      },
      {
        "caixa": {
          "altura": 0.45,
          "esquerda": 0.05,
          "largura": 0.55,
          "topo": 0.45
        },
        "formato": "ean13",
        "fundo": [
          255,
          255,
          255
        ],
        "id": "barras",
        "numero": "cima",
        "raio": 0.1,
        "tipo": "codigoBarras",
        "valor": "{produto.ean}"
      },
      {
        "caixa": {
          "altura": 0.5,
          "direita": 0.05,
          "largura": 0.3,
          "topo": 0.4
        },
        "id": "qr",
        "nivel": "M",
        "tipo": "qrcode",
        "valor": "{link}"
      }
    ],
    "fonte": {
      "familia": "Montserrat",
      "peso": "negrito"
    },
    "fundo": {
      "cor": [
        255,
        255,
        255
      ]
    },
    "orientacao": "paisagem",
    "tamanho": "A6",
    "titulo": "Etiqueta com códigos"
  },
  "versao": "1.0.0"
};
