// polaris: pagina home@1.0.0
export const kind = "pagina";
export const id = "home";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "home",
  "kind": "pagina",
  "spec": {
    "dados": {
      "loja": "dados.loja"
    },
    "raiz": {
      "bloco": "layout/pilha",
      "slots": {
        "filhos": [
          {
            "bloco": "commerce/vitrine",
            "props": {
              "colecao": "destaques"
            }
          },
          {
            "bloco": "texto/titulo",
            "props": {
              "texto": "{produto.nome}"
            },
            "repetir": {
              "cada": "produtos",
              "como": "produto"
            },
            "se": "produtos.length"
          }
        ]
      }
    },
    "rota": "/",
    "titulo": "{loja.nome}"
  },
  "tenantId": null,
  "versao": "1.0.0"
};
