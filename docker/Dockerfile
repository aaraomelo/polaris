# syntax=docker/dockerfile:1
# Uma imagem para serviço e gateway (muda só o comando). Etapa 1: instala e empacota. Etapa 2: só o necessário para rodar, sem root.
ARG NODE_IMAGE=node:22.18-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json ./
# a MESMA versão do pnpm que o repositório declara (corepack depende de rede/assinatura na hora do build; npm com versão fixa é reproduzível)
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm --filter @polaris/apps empacota

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/polaris/dist ./dist
USER node
# o comando decide o processo: node dist/servico.mjs | node dist/gateway.mjs
CMD ["node", "dist/servico.mjs"]
