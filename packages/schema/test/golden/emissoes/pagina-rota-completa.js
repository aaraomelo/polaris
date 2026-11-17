// polaris: pagina produto@1.0.0
export const kind = "pagina";
export const id = "produto";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "produto",
  "kind": "pagina",
  "spec": {
    "guarda": [
      "produto.ler"
    ],
    "layout": "layout/loja",
    "layoutProps": {
      "titulo": "{tenant.nome}"
    },
    "params": {
      "id": {
        "tipo": "uuid"
      }
    },
    "raiz": {
      "bloco": "layout/pilha"
    },
    "rota": "/produtos/:id",
    "rotasI18n": {
      "en": "/products/:id",
      "es": "/productos/:id"
    }
  },
  "versao": "1.0.0"
};
