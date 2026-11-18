// polaris: kernel saxpy@1.0.0
export const kind = "kernel";
export const id = "saxpy";
export const versao = "1.0.0";
export default {
  "id": "saxpy",
  "kind": "kernel",
  "spec": {
    "corpo": {
      "locais": [
        {
          "nome": "t",
          "valor": "a * x"
        }
      ],
      "saidas": {
        "r": "t + y"
      }
    },
    "dominio": {
      "maxElementos": 1000000
    },
    "emissoes": [
      {
        "alvo": "js"
      },
      {
        "alvo": "wasm"
      },
      {
        "alvo": "glsl"
      },
      {
        "alvo": "ptx"
      }
    ],
    "entradas": {
      "a": {
        "tipo": "decimal"
      },
      "x": {
        "lista": true,
        "tipo": "decimal"
      },
      "y": {
        "lista": true,
        "tipo": "decimal"
      }
    },
    "restricoes": [
      "a >= 0"
    ],
    "saidas": {
      "r": {
        "lista": true,
        "tipo": "decimal"
      }
    },
    "tolerancia": {
      "relativa": 0.00001
    }
  },
  "versao": "1.0.0"
};
