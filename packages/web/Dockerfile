# Surakkha Web — production image.
# Multi-stage: install → build Vite SPA → serve via Nginx.

FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --filter @surakkha/web...

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=deps /repo/ ./
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/
RUN pnpm -F @surakkha/shared build && pnpm -F @surakkha/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:80 >/dev/null 2>&1 || exit 1
