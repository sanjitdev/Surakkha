# Surakkha API — production image.
# Multi-stage build: pnpm install → tsc build → distroless runtime.

FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/api/package.json packages/api/
COPY packages/api/tsconfig.json packages/api/
COPY packages/api/src packages/api/src
# Skip the api test tree (`__tests__/`) — production runtime
# never runs vitest, and the build step needs `src/` only.
COPY packages/db/package.json packages/db/
COPY packages/db/tsconfig.json packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/db/scripts packages/db/scripts
RUN pnpm install --frozen-lockfile --filter @surakkha/shared... --filter @surakkha/api... --filter @surakkha/db...

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# Bring the deps stage wholesale — that includes BOTH the
# pnpm-installed `node_modules/` symlink farm AND the source
# trees that we copied into it above. The build stage does
# NOT do a second `COPY packages/<x>/ packages/<x>/` because
# Docker COPY follows symlinks and rewrites them to host-side
# absolute paths, which would break the pnpm symlink farm.
COPY --from=deps /repo/ ./
RUN pnpm -F @surakkha/shared build && pnpm -F @surakkha/api build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Recreate the pnpm workspace in the runtime stage so the api's
# `@surakkha/shared` workspace dep resolves to the shared package
# at `./packages/shared/`. We bring shared's prebuilt `dist/`
# (NOT its `src/`) so production serves compiled JS, but we keep
# the workspace manifest + lockfile so pnpm can resolve the link.
COPY --from=build /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/package.json ./
COPY --from=build /repo/pnpm-lock.yaml ./
COPY --from=build /repo/packages/api/package.json ./packages/api/
COPY --from=build /repo/packages/api/dist ./packages/api/dist
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/db/package.json ./packages/db/
COPY --from=build /repo/packages/db/prisma/schema.prisma ./packages/db/prisma/schema.prisma
COPY --from=build /repo/packages/db/prisma/migrations ./packages/db/prisma/migrations
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
    && pnpm install --frozen-lockfile --filter @surakkha/api... \
    && pnpm add -w -D prisma@5.20.0
# `@prisma/client` expects to find a generated client at
# `node_modules/.prisma/client`. The build stage's `pnpm install`
# did NOT run `prisma generate` (db's schema isn't present there),
# so the runtime client is empty. Generate it from the schema we
# copied in above.
RUN pnpm exec prisma generate --schema=packages/db/prisma/schema.prisma
EXPOSE 3000
USER node
WORKDIR /app/packages/api
# Run the api through tsx so ESM imports without `.js`
# extensions resolve transparently. tsx is a devDep of `@surakkha/api`
# and is installed by the line above (no `--prod` here on purpose).
CMD ["npx", "tsx", "dist/index.js"]
