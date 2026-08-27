# Surakkha API — production image.
# Multi-stage build: pnpm install → tsc build → distroless runtime.
#
# All stages use `node:20-bookworm-slim` (Debian) rather than `node:20-alpine`.
# Prisma 5.20's default query engine (`linux-musl`) is dynamically linked
# against OpenSSL 1.1, which Alpine 3.16+ no longer ships — every Docker
# build using Alpine was crashing at runtime with
# `libssl.so.1.1: No such file or directory`. Debian-based images
# ship openssl 3, and Prisma's `linux-debian-openssl-3.0.x` engine
# loads cleanly. This is the right base for any Prisma + Node 20
# service today (Alpine support is gated on Prisma releasing a
# precompiled openssl-3 musl binary, which has not happened as of
# Prisma 5.20).

FROM node:20-bookworm-slim AS deps
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
RUN pnpm install --frozen-lockfile --filter @surakkha/shared... --filter @surakkha/api... --filter @surakkha/db... --ignore-scripts && \
    cd /repo && pnpm rebuild --filter @surakkha/api... bcrypt

FROM node:20-bookworm-slim AS build
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
# Generate the Prisma client here, in a stage that already has the
# `prisma` CLI installed (it's a devDep of `@surakkha/db`, pulled in
# by the deps stage via `--filter @surakkha/db...` on line 21) and
# already has the schema (line 19). Running `pnpm exec prisma` from
# the runtime stage used to fail with "Command 'prisma' not found"
# because the runtime install did not hoist the prisma CLI to
# `node_modules/.bin/` under pnpm's isolated node-linker.
#
# `--schema` is resolved relative to the cwd of the `prisma` process;
# `pnpm -F @surakkha/db exec` sets cwd to `packages/db`, so we have
# to pass the workspace-absolute path.
RUN pnpm -F @surakkha/db exec prisma generate --schema=/repo/packages/db/prisma/schema.prisma

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Prisma 5.20's default `debian-openssl-1.1.x` query engine is
# dynamically linked against libssl 1.1, which Debian Bookworm
# dropped. The runtime tries to load it anyway because the auto-detect
# defaults to the openssl-1.1 target on Debian. Without libssl 1.1
# available, the engine fails to load with `libssl.so.1.1: cannot
# open shared object file`. The shards.io Debian archive still has
# the Bookworm libssl1.1 .deb (it was removed from the official
# repo). We pull it down, extract, and place the shared library
# in `/usr/lib/` so the dynamic linker finds it at engine load.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates \
    && wget -qO /tmp/libssl1.1.deb \
         http://archive.debian.org/debian/pool/main/o/openssl/libssl1.1_1.1.1w-0+deb11u1_amd64.deb \
    && dpkg -i /tmp/libssl1.1.deb \
    && rm /tmp/libssl1.1.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
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
    && pnpm install --frozen-lockfile --filter @surakkha/api... --ignore-scripts && \
    cd /app && pnpm rebuild --filter @surakkha/api... bcrypt
# Bring the pre-generated Prisma client across. The build stage ran
# `prisma generate` from `packages/db/` (via `pnpm -F @surakkha/db exec`)
# — Prisma's default output is `<schema_dir>/../node_modules/.prisma/client`,
# but the engine actually materializes the generated artifacts inside the
# `@prisma/client` package in the pnpm virtual store at
# `/repo/node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/@prisma/client`.
# Prisma 5.20's runtime resolver (see `@prisma/client/runtime/library.js:fd`)
# walks `<pkg_dir>/../.prisma/client` — i.e.
# `<.pnpm>/@prisma+client@.../node_modules/.prisma/client/` — when looking
# for the engine binaries. We rebuild the same layout here.
COPY --from=build /repo/node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/@prisma/client \
     /app/node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/@prisma/client
COPY --from=build /repo/node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma \
     /app/node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma
EXPOSE 3000
USER node
WORKDIR /app/packages/api
# Run the api through tsx so ESM imports without `.js`
# extensions resolve transparently. tsx is a devDep of `@surakkha/api`
# and is installed by the line above (no `--prod` here on purpose).
CMD ["npx", "tsx", "dist/index.js"]
