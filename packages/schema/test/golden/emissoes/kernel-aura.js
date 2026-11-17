// polaris: kernel aura@1.0.0
export const kind = "kernel";
export const id = "aura";
export const versao = "1.0.0";
export default {
  "emit": [
    "glsl",
    "wasm"
  ],
  "id": "aura",
  "kind": "kernel",
  "spec": {
    "emissoes": [
      {
        "alvo": "glsl",
        "backend": "glsl"
      },
      {
        "alvo": "wasm",
        "backend": "wasm"
      }
    ],
    "entradas": {
      "amplitude": {
        "tipo": "decimal"
      }
    },
    "saidas": {
      "cor": {
        "tipo": "json"
      }
    }
  },
  "versao": "1.0.0"
};
