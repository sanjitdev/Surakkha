/* eslint-env node */
// `db:seed:docker` orchestration - Story 4.4 follow-up.
//
// `pnpm db:seed` (see `package.json`) writes to the host Postgres at
// `localhost:5432` (per `packages/db/.env`). When the API is running
// via `docker compose up` (the default compose file), the API reads
// from the in-stack `db` service - a different Postgres 15 with
// volume `surakkha-postgres-data`. The two databases never share
// data, so `pnpm db:seed` alone does NOT make incidents appear in
// `/incidents` for a `docker compose up` stack.
//
// This script bridges the gap: pipes each .mjs seed script into the
// running `surakkha-api` container via `docker exec -i ... node -`,
// which loads `@prisma/client` from the api's already-installed
// node_modules and connects to the docker db (`db:5432`). The api's
// own runtime environment sets up DATABASE_URL via the docker
// compose env block, so we don't need to override it here.
//
// Why pipe rather than bind-mount: the api image is a slim prod
// image without the seed scripts or the db package. A bind mount
// would create a separate workspace mount per developer, which is
// hard to keep portable across macOS, Linux, and Windows.
// Std-in pipe keeps the orchestration entirely in docker-exec land.
//
// Idempotency: each of the three .mjs scripts is independently
// idempotent (`upsert` or skip-if-exists), so re-running this
// orchestration is safe.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_CONTAINER = "surakkha-api";

// Order matches `db:seed` (see `package.json`): devices before rules
// before incidents. Rules need the device rows already in the DB only
// by accident - `findRule` in seed-incidents.mjs reads from `Rule`
// which the api's startup hook already populated. Devices + rules
// here are a defense-in-depth re-seed in case the api image was
// built without the startup hook or the docker db was reset.
const SEED_SCRIPTS = ["seed-devices.mjs", "seed-rules.mjs", "seed-incidents.mjs"];

// Verify the api container is running before we start. Surfacing
// "container not found" early prevents a silent failure where the
// pipe fails on the docker side with no useful context.
const checkContainerUp = () => {
  const result = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", API_CONTAINER], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `db:seed:docker: api container '${API_CONTAINER}' is not running. ` +
        "Bring the stack up with `docker compose up` (or `docker compose -f docker-compose.dev.yml up`) first.",
    );
  }
  const running = (result.stdout ?? "").trim();
  if (running !== "true") {
    throw new Error(
      `db:seed:docker: api container '${API_CONTAINER}' is not running (state: ${running}). ` +
        "Start the stack and retry.",
    );
  }
};

// Pipe a seed script into the api container's node interpreter.
// `docker exec -i ... node -` reads stdin and executes it as a
// module - same as `cat script.mjs | docker exec ... node -`.
const pipeSeedIntoContainer = (scriptPath) => {
  const body = readFileSync(scriptPath, "utf8");
  // Use `globalThis.console` to bypass the ESLint no-undef rule
  // (matches the convention in seed-devices/seed-rules/seed-incidents).
  globalThis.console.log(`db:seed:docker -> piping ${scriptPath}`);
  const result = spawnSync(
    "docker",
    ["exec", "-i", "-u", "node", API_CONTAINER, "node", "--input-type=module"],
    {
      input: body,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `db:seed:docker: seed script '${scriptPath}' exited with code ${result.status}`,
    );
  }
};

const main = () => {
  checkContainerUp();
  for (const script of SEED_SCRIPTS) {
    const scriptPath = resolve(__dirname, script);
    pipeSeedIntoContainer(scriptPath);
  }
  globalThis.console.log(
    "db:seed:docker: done. Refresh /incidents in the SPA to see the seeded data.",
  );
};

try {
  main();
} catch (err) {
  globalThis.console.error(err instanceof Error ? err.message : err);
  globalThis.process.exit(1);
}
