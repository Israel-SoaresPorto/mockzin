# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm -r build
RUN pnpm --filter @mock-api/server --prod deploy --legacy /prod

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
USER node

COPY --chown=node:node --from=build /prod ./

EXPOSE 4000
CMD ["node", "dist/server.js"]
