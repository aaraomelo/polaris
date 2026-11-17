// polaris: servico catalogo@1.0.0
export const kind = "servico";
export const id = "catalogo";
export const versao = "1.0.0";
export default {
  "id": "catalogo",
  "kind": "servico",
  "spec": {
    "entidades": {
      "produto": {
        "campos": {
          "nome": {
            "obrigatorio": true,
            "tipo": "texto"
          },
          "preco": {
            "obrigatorio": true,
            "tipo": "dinheiro"
          }
        }
      }
    },
    "operacoes": {
      "listarProdutos": {
        "caminho": "/produtos",
        "metodo": "GET",
        "permissao": "produto.ler",
        "saida": "produto"
      }
    }
  },
  "versao": "1.0.0"
};
