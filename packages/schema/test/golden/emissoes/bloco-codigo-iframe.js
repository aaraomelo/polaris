// polaris: bloco mapa@1.0.0
export const kind = "bloco";
export const id = "mapa";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "mapa",
  "kind": "bloco",
  "spec": {
    "codigo": {
      "altura": 300,
      "fonte": "\u003ch1>{{props.t}}\u003c/h1>",
      "linguagem": "html",
      "permissoes": [
        "imagens:https://tiles.exemplo.com",
        "rede:https://api.exemplo.com:8443",
        "formularios"
      ]
    },
    "interface": "x/mapa"
  },
  "versao": "1.0.0"
};
