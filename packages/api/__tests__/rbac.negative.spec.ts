/**
 * Story 1.8 — Negative RBAC Tests (Covers FR-21).
 *
 * Pins the (subject, action, resource) → 403 contract that
 * `pnpm lint:rbac` enforces for new handlers. Every case in
 * `NEGATIVE_CASES` runs through the real `authorize` middleware so a
 * regression in the gate shows up here before it ships.
 *
 * Coverage matrix (each entry is one `it(...)` block):
 *   index  subject     action           resource          expected
 *      1   Viewer      create           Incident          403
 *      3   Technician  read             Incident          403  (ownership)
 *      4   Viewer      submit_result    Incident          403
 *      5   Operator    drive            Simulator         403
 *      6   Technician  export           Reading           403
 *      7   Operator    read             SeverityBanner    403
 *      8   Viewer      update           Rule              403
 *      9   Operator    manage           User              403
 *     10   Technician  submit_result    Incident          403  (ownership)
 *     11   Viewer      manage           User              403
 *     12   Technician  delete           Device            403
 *     13   Operator    reopen           Incident          403
 *     14   Viewer      acknowledge      Incident          403
 *     15   Technician  resolve          Incident          403
 *     16   Viewer      acknowledge      Alert             403
 *     17   Technician  acknowledge      Alert             403
 *     18   Operator    update           Rule              403
 *     19   Technician  update           Rule              403
 *     20   Operator    update           Rule (POST)       403
 *
 * Total: 19 negative cases (Story 1.8 floor: 10; Story 3.5 adds cases
 * 16 + 17 for the Alert.acknowledge deny cells; Story 3.7 adds cases
 * 18 + 19 + 20 for the Rule.update deny cells on the /admin/thresholds
 * admin tab; Story 5.3 removes the former index 1 `Operator → read
 * AuditLog` case because the production endpoint now lives behind
 * the real `mountAuditRouter` mount — covered by
 * `audit/router.spec.ts:RBAC_OPERATOR`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Server, createServer } from "node:http";
import { type AddressInfo } from "node:net";

import { type AuditAction, type Role as RbacRole } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../src/audit";
import { issueAccessToken } from "../src/auth/jwt";
import {
  NEGATIVE_CASES,
  SUBJECT_UUID,
  buildRbacNegativeApp,
} from "../src/__tests__/rbacNegativeRouter";

interface AuditEvent {
  readonly auditAction: AuditAction;
  readonly userId?: string;
  readonly outcome: "success" | "failure";
  readonly context?: Record<string, unknown>;
}

const STRONG_SECRET = "x".repeat(64);
let originalSecret: string | undefined;

const setSecret = (v: string | undefined) => {
  if (v === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = v;
};

const startApp = async (
  audit: AuditLogger,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app = buildRbacNegativeApp(audit);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { url, close };
};

const tokenFor = (subject: RbacRole): string =>
  issueAccessToken({ userId: SUBJECT_UUID[subject], role: subject }).token;

describe("Story 1.8 — Negative RBAC register (FR-21)", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  // Drive every case from the NEGATIVE_CASES table. The data-driven
  // structure makes the test register self-documenting: each row
  // points to a row in `docs/architecture-appendix-rbac.md`.
  for (const c of NEGATIVE_CASES) {
    it(`#${c.index.toString().padStart(2, "0")} ${c.subject} → ${c.action} → ${c.resource} (${c.appendixRow}) returns ${c.expected}`, async () => {
      const events: AuditEvent[] = [];
      const audit: AuditLogger = { emit: (e) => events.push(e) };
      const { url, close } = await startApp(audit);

      const res = await fetch(`${url}${c.path}`, {
        method: c.method.toUpperCase(),
        headers: {
          Authorization: `Bearer ${tokenFor(c.subject)}`,
          "Content-Type": "application/json",
          // Bodies body for POST cases so the json middleware is
          // exercised end-to-end. Empty JSON is acceptable to the
          // stub handler at the end of the chain.
          ...(c.method === "post" || c.method === "patch" || c.method === "put"
            ? { body: "{}" }
            : {}),
        },
      });

      expect(res.status).toBe(c.expected);

      if (c.expected === 403) {
        const body = (await res.json()) as {
          error: string;
          required_role: string;
        };
        expect(body.error).toBe("forbidden");
        // required_role is a role string from the matrix's smallest-
        // granting set. We do NOT pin the exact value here because
        // that's the responsibility of the per-cell smoke tests in
        // `authorize.spec.ts`. We only assert the field is present.
        expect(typeof body.required_role).toBe("string");
        expect(body.required_role.length).toBeGreaterThan(0);

        // Every 403 writes a `rbac_denied` audit row carrying the
        // subject/action/resource/context.
        const denial = events.find((e) => e.auditAction === "rbac_denied");
        expect(denial).toBeDefined();
        expect(denial?.outcome).toBe("failure");
        expect(denial?.userId).toBe(SUBJECT_UUID[c.subject]);
        expect(denial?.context).toMatchObject({
          subject: c.subject,
          action: c.action,
          resource: c.resource,
        });
        // For the ownership case, the context also carries
        // `reason: "not_assignee"`.
        if (c.appendixRow.includes("not assignee") || c.appendixRow.includes("(not assignee)")) {
          expect(denial?.context).toMatchObject({ reason: "not_assignee" });
        }
      } else {
        // Allow-case (matrix-level pass). The `authorize()`
        // middleware now writes a `rbac_allowed` audit row on every
        // successful allow (see authorize.ts:206-215); the loopback
        // assertion below pins that row exactly once. No 403.
        expect(events.length).toBe(1);
        expect(events[0]?.auditAction).toBe("rbac_allowed");
        expect(events[0]?.outcome).toBe("allow");
      }

      await close();
    });
  }

  it("denies a Technician reading an incident assigned to a different user (ownership case)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);

    // The negative router hard-codes the ownership comparison to the
    // Admin UUID — a Technician token is never the owner.
    const res = await fetch(`${url}/incidents/abc`, {
      headers: { Authorization: `Bearer ${tokenFor("Technician")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body).toMatchObject({
      error: "forbidden",
      required_role: "Technician",
    });

    const denial = events.find((e) => e.auditAction === "rbac_denied");
    expect(denial?.context).toMatchObject({ reason: "not_assignee" });
    await close();
  });

  it("admits an Admin reading the same incident (matrix + ownership pass)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);

    const res = await fetch(`${url}/incidents/abc`, {
      headers: { Authorization: `Bearer ${tokenFor("Admin")}` },
    });
    expect(res.status).toBe(200);
    // Successful matrix + ownership pass: `authorize()` writes a
    // single `rbac_allowed` audit row (see authorize.ts:206-215);
    // `requireOwner()` is a no-op (Admin bypasses ownership).
    expect(events.length).toBe(1);
    expect(events[0]?.auditAction).toBe("rbac_allowed");
    expect(events[0]?.outcome).toBe("allow");
    await close();
  });
});
