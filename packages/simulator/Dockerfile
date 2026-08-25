# Surakkha Simulator — production image.
# Same wire contract as a real device (AR-12, I-12).

FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/simulator/package.json packages/simulator/
COPY packages/simulator/tsconfig.json packages/simulator/
COPY packages/simulator/src packages/simulator/src
RUN pnpm install --frozen-lockfile --filter @surakkha/shared... --filter @surakkha/simulator...

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# See api/Dockerfile for why the build stage skips a second COPY.
COPY --from=deps /repo/ ./
RUN pnpm -F @surakkha/shared build && pnpm -F @surakkha/simulator build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# See api/Dockerfile for the workspace reconstruction rationale.
COPY --from=build /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/package.json ./
COPY --from=build /repo/pnpm-lock.yaml ./
COPY --from=build /repo/packages/simulator/package.json ./packages/simulator/
COPY --from=build /repo/packages/simulator/dist ./packages/simulator/dist
# `tsc` with `rootDir: ./src` + `include: ["src/**/*.ts"]` emits only
# `.js`/`.d.ts` — JSON config files (devices.json) are not compiled.
# The simulator reads `devices.json` from `__dirname` at runtime
# (packages/simulator/src/index.ts:48), so the file must be present
# in `dist/` inside the runtime image. Copy it explicitly.
COPY --from=build /repo/packages/simulator/src/devices.json ./packages/simulator/dist/devices.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
    && pnpm install --frozen-lockfile --prod --filter @surakkha/simulator...
USER node
WORKDIR /app/packages/simulator
CMD ["node", "dist/index.js"]
