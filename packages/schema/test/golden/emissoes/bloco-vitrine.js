// polaris: bloco commerce.vitrine@1.0.0
export const kind = "bloco";
export const id = "commerce.vitrine";
export const versao = "1.0.0";
export default {
  "id": "commerce.vitrine",
  "kind": "bloco",
  "spec": {
    "extends": "layout/lista",
    "interface": "commerce/vitrine",
    "props": {
      "properties": {
        "colecao": {
          "type": "string"
        }
      },
      "required": [
        "colecao"
      ],
      "type": "object"
    },
    "slots": {
      "item": {
        "aceita": [
          "commerce/cartao-produto"
        ],
        "min": 1
      }
    }
  },
  "versao": "1.0.0"
};
