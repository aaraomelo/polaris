// polaris: tenant loja-i18n@1.0.0
export const kind = "tenant";
export const id = "loja-i18n";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "loja-i18n",
  "kind": "tenant",
  "spec": {
    "alias": "loja-i18n",
    "idiomaPadrao": "pt-BR",
    "idiomas": [
      "pt-BR",
      "en"
    ],
    "paginaNaoEncontrada": "nao-encontrada",
    "paginaNegado": "negado",
    "paginas": [
      "home",
      "produto"
    ],
    "redirecionamentos": [
      {
        "de": "/antiga/:id",
        "para": "/produtos/:id",
        "status": 301
      },
      {
        "de": "/promo",
        "para": "/ofertas"
      }
    ],
    "rotaLogin": "/entrar",
    "segmento": "varejo"
  },
  "versao": "1.0.0"
};
