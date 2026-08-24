/**
 * Pure helpers extracted from `seed.ts` so the seed's `deriveName`
 * and `assertValidScenario` can be unit-tested without booting
 * Prisma or risking `process.exit`.
 *
 * Anything that touches the filesystem, Prisma, or `process.exit`
 * stays in `seed.ts`.
 */

import { SCENARIO_NAMES, type ScenarioName } from "@surakkha/shared/simulator";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_TAIL_HEX_CHARS = 4;

/**
 * Derive a stable v1 placeholder name from a UUIDv4 device_id's last
 * 4 hex digits.
 *
 * - UUIDv4 format enforced (8-4-4-4-12 with version 4 + variant 8/9/a/b).
 * - Last-4-hex keeps labels unique across UUIDv4 distributions
 *   (two UUIDv4s share a 4-char tail with probability 2^-16).
 * - Hex letters are uppercased so the admin tab label is canonical.
 * - Throws on empty / malformed input so a typo'd `devices.json`
 *   never lands a junk label in the DB.
 */
export const deriveName = (deviceId: string): string => {
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw new Error(
      `seed: device_id must be a non-empty UUIDv4 string: ${deviceId}`,
    );
  }
  if (!UUID_V4_PATTERN.test(deviceId)) {
    throw new Error(
      `seed: device_id must be a valid UUIDv4 (8-4-4-4-12 with v4 / variant 8-b): ${deviceId}`,
    );
  }
  const tail = deviceId.slice(-NAME_TAIL_HEX_CHARS).toUpperCase();
  return `DEVICE-${tail}`;
};

/**
 * Assert that a scenario name is one of the seven documented names.
 * Throws otherwise so a typo'd `devices.json` never lands a value the
 * api's input validator would later reject.
 */
export const assertValidScenario = (
  scenario: string,
): asserts scenario is ScenarioName => {
  if (!(SCENARIO_NAMES as readonly string[]).includes(scenario)) {
    throw new Error(
      `seed: invalid scenario "${scenario}" (must be one of: ${SCENARIO_NAMES.join(", ")})`,
    );
  }
};
