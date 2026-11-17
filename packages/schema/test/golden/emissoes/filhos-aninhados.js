// polaris: pagina pai@1.0.0
export const kind = "pagina";
export const id = "pai";
export const versao = "1.0.0";
export default {
  "filhos": [
    {
      "id": "filha",
      "kind": "pagina",
      "spec": {
        "raiz": {
          "bloco": "layout/pilha"
        },
        "rota": "/pai/filha"
      },
      "versao": "1.0.0"
    }
  ],
  "id": "pai",
  "kind": "pagina",
  "spec": {
    "raiz": {
      "bloco": "layout/pilha"
    },
    "rota": "/pai"
  },
  "versao": "1.0.0"
};
