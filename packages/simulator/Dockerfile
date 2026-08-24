# Surakkha Simulator — production image.
# Same wire contract as a real device (AR-12, I-12).

FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/simulator/package.json packages/simulator/
RUN pnpm install --frozen-lockfile --filter @surakkha/simulator...

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=deps /repo/ ./
# `node_modules/` is excluded from the build context via the repo
# `.dockerignore`, so these COPY lines bring in source trees
# without clobbering the deps stage's symlink farm.
COPY packages/shared/ packages/shared/
COPY packages/simulator/ packages/simulator/
RUN pnpm -F @surakkha/shared build && pnpm -F @surakkha/simulator build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/packages/simulator/dist ./dist
COPY --from=build /repo/packages/simulator/node_modules ./node_modules
COPY --from=build /repo/packages/shared/dist ./node_modules/@surakkha/shared/dist
COPY --from=build /repo/packages/shared/package.json ./node_modules/@surakkha/shared/package.json
USER node
CMD ["node", "dist/index.js"]
