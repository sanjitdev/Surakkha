/**
 * `transitionEnvelope.spec.ts` — unit tests for the canonical
 * 409 envelope parser + the per-verb message discriminator.
 *
 * Closes web-side P1 #3 (api critique). Mirrors the api-side
 * shape assertion coverage in `packages/api/src/incidents/
 * router.spec.ts:260-262, 783-784, 867-869` so the wire contract
 * stays in lock-step.
 *
 * Coverage:
 *   - `parseTransitionEnvelope` accepts the typed-miss body
 *   - `parseTransitionEnvelope` accepts the concurrency body
 *   - `parseTransitionEnvelope` returns null on a non-envelope
 *     body (defensive — the api never emits one but a future
 *     schema bump could)
 *   - `invalidTransitionMessage` for each of 5 verbs × 3 branches
 *     (concurrency / typed-miss / fallback) = 15 assertions
 */
import { describe, expect, it } from "vitest";

import {
  invalidTransitionMessage,
  parseTransitionEnvelope,
  type TransitionVerb,
} from "./transitionEnvelope";

describe("parseTransitionEnvelope", () => {
  it("accepts the typed-miss body (from + attempted)", () => {
    const body = {
      error: "invalid_state_transition",
      from: "ACKNOWLEDGED",
      attempted: "acknowledge",
    };
    expect(parseTransitionEnvelope(body)).toEqual(body);
  });

  it("accepts the concurrency body (reason: concurrent_modification)", () => {
    const body = {
      error: "invalid_state_transition",
      reason: "concurrent_modification",
    };
    expect(parseTransitionEnvelope(body)).toEqual(body);
  });

  it("returns null on a non-envelope body (defensive)", () => {
    expect(parseTransitionEnvelope({ error: "unauthorized" })).toBeNull();
    expect(parseTransitionEnvelope(null)).toBeNull();
    expect(parseTransitionEnvelope("not an object")).toBeNull();
    expect(parseTransitionEnvelope({})).toBeNull();
  });

  it("returns null when the discriminator is wrong", () => {
    expect(
      parseTransitionEnvelope({
        error: "validation_error",
        from: "OPEN",
        attempted: "acknowledge",
      }),
    ).toBeNull();
  });
});

describe("invalidTransitionMessage", () => {
  // The 5 verbs × 3 branches = 15 cells. We exercise every cell.
  const VERBS: readonly TransitionVerb[] = [
    "acknowledge",
    "assign",
    "submit_result",
    "resolve",
    "reopen",
  ];

  describe("concurrency path (priority 1)", () => {
    it.each(VERBS)("%s → 'Modified by another operator — refresh and retry'", (verb) => {
      const message = invalidTransitionMessage(verb, {
        error: "invalid_state_transition",
        reason: "concurrent_modification",
      });
      expect(message).toBe("Modified by another operator — refresh and retry");
    });
  });

  describe("typed state-machine miss (priority 2)", () => {
    it("acknowledge from SAFE → 'Cannot acknowledge a safe incident'", () => {
      expect(
        invalidTransitionMessage("acknowledge", {
          error: "invalid_state_transition",
          from: "SAFE",
          attempted: "acknowledge",
        }),
      ).toBe("Cannot acknowledge a safe incident");
    });

    it("reopen from OPEN → 'Cannot reopen an open incident'", () => {
      expect(
        invalidTransitionMessage("reopen", {
          error: "invalid_state_transition",
          from: "OPEN",
          attempted: "reopen",
        }),
      ).toBe("Cannot reopen an open incident");
    });

    it("submit_result from RESOLVED → 'Cannot submit a result for a resolved incident'", () => {
      expect(
        invalidTransitionMessage("submit_result", {
          error: "invalid_state_transition",
          from: "RESOLVED",
          attempted: "submit_result",
        }),
      ).toBe("Cannot submit a result for a resolved incident");
    });

    it("assign from RESOLVED → 'Cannot assign a resolved incident'", () => {
      expect(
        invalidTransitionMessage("assign", {
          error: "invalid_state_transition",
          from: "RESOLVED",
          attempted: "assign",
        }),
      ).toBe("Cannot assign a resolved incident");
    });

    it("resolve from OPEN → 'Cannot resolve an open incident'", () => {
      expect(
        invalidTransitionMessage("resolve", {
          error: "invalid_state_transition",
          from: "OPEN",
          attempted: "resolve",
        }),
      ).toBe("Cannot resolve an open incident");
    });

    it("falls back to the raw `from` label if the state is unknown", () => {
      // Defensive — Zod's enum is exhaustive but a stale client
      // could see a future state the web bundle hasn't been
      // rebuilt against. Use a typed cast to bypass Zod's enum
      // and exercise the fallback branch.
      const message = invalidTransitionMessage("acknowledge", {
        error: "invalid_state_transition",
        from: "FUTURE_STATE" as never,
        attempted: "acknowledge",
      });
      expect(message).toBe("Cannot acknowledge a FUTURE_STATE incident");
    });
  });

  describe("per-verb fallback (priority 3 — no structured fields)", () => {
    it.each(VERBS)("%s → per-verb fallback copy", (verb) => {
      const expected: Record<TransitionVerb, string> = {
        acknowledge: "Already acknowledged",
        assign: "Already assigned",
        submit_result: "Already submitted",
        resolve: "Already resolved",
        reopen: "Cannot reopen — incident is not RESOLVED",
      };
      expect(
        invalidTransitionMessage(verb, {
          error: "invalid_state_transition",
        }),
      ).toBe(expected[verb]);
    });
  });
});
