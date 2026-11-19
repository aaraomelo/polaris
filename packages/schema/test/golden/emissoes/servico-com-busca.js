// polaris: servico vitrine-busca@1.0.0
export const kind = "servico";
export const id = "vitrine-busca";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "vitrine-busca",
  "kind": "servico",
  "spec": {
    "entidades": {
      "artigo": {
        "busca": {
          "campos": [
            "titulo",
            "resumo"
          ]
        },
        "campos": {
          "publicado": {
            "padrao": true,
            "tipo": "booleano"
          },
          "resumo": {
            "tipo": "texto"
          },
          "titulo": {
            "obrigatorio": true,
            "tipo": "texto"
          }
        },
        "crud": {
          "caminho": "/artigos",
          "operacoes": [
            "listar",
            "obter"
          ],
          "permissao": "publica"
        }
      }
    },
    "operacoes": {}
  },
  "versao": "1.0.0"
};
