/**
 * `packages/simulator/Dockerfile` — contract pin.
 *
 * The simulator reads `devices.json` from `__dirname` at runtime
 * (packages/simulator/src/index.ts:48 → resolves to
 * `/app/packages/simulator/dist/devices.json` in the runtime image).
 *
 * `tsc` with `rootDir: ./src` + `include: ["src/**.ts"]` emits only
 * `.js` / `.d.ts` artifacts - JSON config files are NOT compiled.
 * Without an explicit COPY in the Dockerfile's runtime stage, the
 * container boots, the entry point throws `ENOENT`, and the
 * container enters a restart loop (every previous bring-up of the
 * stack observed this).
 *
 * This source-walk test pins the contract so future Dockerfile edits
 * can't silently regress the runtime contract.
 *
 * Mirrors the shape of packages/api/__tests__/health.public.spec.ts
 * and packages/web/src/__tests__/nginx.routes.spec.ts — text-shape,
 * no Docker daemon required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolve Dockerfile relative to THIS file so the test is robust to
// whether vitest is invoked from the repo root or from
// packages/simulator. Spec lives at
// packages/simulator/src/__tests__/dockerfile.devicesJson.spec.ts;
// Dockerfile lives at packages/simulator/Dockerfile - two levels up
// from the spec.
const HERE = dirname(fileURLToPath(import.meta.url));
const DOCKERFILE_PATH = join(HERE, "..", "..", "Dockerfile");
const readDockerfile = (): string => readFileSync(DOCKERFILE_PATH, "utf8");

describe("simulator Dockerfile — devices.json is present in the runtime image", () => {
  const dockerfile = readDockerfile();

  it("declares a runtime stage", () => {
    expect(dockerfile).toMatch(/FROM\s+\S+\s+AS\s+runtime/);
  });

  it("copies the built simulator dist into the runtime stage", () => {
    // The src -> dist pipeline lands in the runtime via
    // `COPY --from=build .../dist .../dist`. Without this line the
    // runtime has no entry point to execute.
    expect(dockerfile).toMatch(
      /COPY\s+--from=build\s+\/repo\/packages\/simulator\/dist\s+\.\/packages\/simulator\/dist/,
    );
  });

  it("copies devices.json into the runtime dist directory", () => {
    // The actual fix: tsc does not emit JSON, so we must copy the
    // source devices.json into dist/ in the runtime stage. Pin the
    // location of the source (src/devices.json) and the destination
    // (./packages/simulator/dist/devices.json) so the contract is
    // explicit.
    expect(dockerfile).toMatch(
      /COPY\s+--from=build\s+\/repo\/packages\/simulator\/src\/devices\.json\s+\.\/packages\/simulator\/dist\/devices\.json/,
    );
  });
});
