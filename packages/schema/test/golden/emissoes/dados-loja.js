// polaris: dados dados.loja@1.0.0
export const kind = "dados";
export const id = "dados.loja";
export const versao = "1.0.0";
export default {
  "id": "dados.loja",
  "kind": "dados",
  "spec": {
    "cache": {
      "ttlSegundos": 60
    },
    "fonte": {
      "operacao": "obterLoja",
      "servico": "catalogo",
      "tipo": "servico"
    }
  },
  "versao": "1.0.0"
};
