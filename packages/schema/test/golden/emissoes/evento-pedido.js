// polaris: evento pedido.criado@1.0.0
export const kind = "evento";
export const id = "pedido.criado";
export const versao = "1.0.0";
export default {
  "id": "pedido.criado",
  "kind": "evento",
  "spec": {
    "idempotencia": "pedidoId",
    "nome": "pedido.criado",
    "payload": {
      "pedidoId": {
        "obrigatorio": true,
        "tipo": "uuid"
      }
    },
    "produtor": "pedidos"
  },
  "versao": "1.0.0"
};
