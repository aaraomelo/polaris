# syntax=docker/dockerfile:1
# Uma imagem para serviço e gateway (muda só o comando). Etapa 1: instala e empacota. Etapa 2: só o necessário para rodar, sem root.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm --filter @polaris/apps empacota

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/polaris/dist ./dist
USER node
# o comando decide o processo: node dist/servico.mjs | node dist/gateway.mjs
CMD ["node", "dist/servico.mjs"]
