# Fixtures congeladas

`v<N>/` guarda nós válidos **no major N** do schema. **Nunca edite** depois de criadas: elas provam a compatibilidade para trás.
Ao subir `ESQUEMA_ATUAL[kind]` para N+1: (1) escreva a migração N→N+1 e registre no teste; (2) crie `v<N+1>/` com nós novos;
(3) a suíte migra todo `v1..vN` até o major atual e valida. Adicionar campo opcional não muda o major e não exige migração.
