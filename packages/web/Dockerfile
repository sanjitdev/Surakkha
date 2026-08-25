# Surakkha Web — production image.
# Multi-stage: install → build Vite SPA → serve via Nginx.

FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/web/package.json packages/web/
COPY packages/web/tsconfig.json packages/web/
COPY packages/web/src packages/web/src
COPY packages/web/index.html packages/web/
COPY packages/web/postcss.config.js packages/web/
COPY packages/web/tailwind.config.ts packages/web/
RUN pnpm install --frozen-lockfile --filter @surakkha/shared... --filter @surakkha/web...

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# See api/Dockerfile for why the build stage skips a second COPY.
COPY --from=deps /repo/ ./
RUN pnpm -F @surakkha/shared build && pnpm -F @surakkha/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:80 >/dev/null 2>&1 || exit 1
