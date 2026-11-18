// polaris: formulario identidade.entrar@1.0.0
export const kind = "formulario";
export const id = "identidade.entrar";
export const versao = "1.0.0";
export default {
  "estatuto": "publicado",
  "id": "identidade.entrar",
  "kind": "formulario",
  "spec": {
    "acoes": [
      {
        "estilo": "primario",
        "id": "entrar",
        "rotulo": "Entrar",
        "tipo": "enviar"
      }
    ],
    "campos": [
      {
        "autocompletar": "username",
        "nome": "email",
        "obrigatorio": true,
        "rotulo": "E-mail",
        "tipo": "email"
      },
      {
        "autocompletar": "current-password",
        "nome": "senha",
        "obrigatorio": true,
        "rotulo": "Senha",
        "tipo": "senha"
      },
      {
        "nome": "volta",
        "tipo": "oculto"
      }
    ],
    "envio": {
      "sistema": "entrar"
    },
    "titulo": "Entrar"
  },
  "versao": "1.0.0"
};
