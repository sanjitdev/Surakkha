/**
 * Story 2.6 — subscriber room-join logic.
 *
 * Covers:
 *   - `handleSubscriberConnection`: token verify path, missing-token
 *     reject, invalid-token reject, room-join success, no `frame`
 *     listener registered (read-only by construction).
 *   - `SUBSCRIBER_PATH_SEGMENT` / `SUBSCRIBER_ROOM` constants
 *     match the wire shape the api and web agree on.
 *
 * The frame-level integration test (real `IoServer`, real subscriber
 * client, real `reading:new` round-trip) lives in
 * `subscriberSocket.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { issueAccessToken } from "../auth/jwt.js";

import {
  handleSubscriberConnection,
  SUBSCRIBER_PATH_SEGMENT,
  SUBSCRIBER_ROOM,
  type SubscriberSocket,
} from "./subscriber";

/**
 * `issueAccessToken` reads `process.env.JWT_SECRET` at call time. The
 * other api specs seed a 64-char secret in their `beforeEach`; we do
 * the same so the suite is deterministic regardless of host env.
 */
const STRONG_SECRET = "x".repeat(64);
let originalSecret: string | undefined;

describe("subscriber path constants", () => {
  it("exports SUBSCRIBER_PATH_SEGMENT === 'dashboard' so the web client can hardcode it", () => {
    expect(SUBSCRIBER_PATH_SEGMENT).toBe("dashboard");
  });

  it("exports SUBSCRIBER_ROOM === 'readings:latest' matching the api's emit side", () => {
    expect(SUBSCRIBER_ROOM).toBe("readings:latest");
  });
});

describe("handleSubscriberConnection", () => {
  let emitSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;
  let joinSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = STRONG_SECRET;
    emitSpy = vi.fn();
    disconnectSpy = vi.fn();
    joinSpy = vi.fn();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env["JWT_SECRET"];
    else process.env["JWT_SECRET"] = originalSecret;
    vi.restoreAllMocks();
  });

  const buildSocket = (auth: Record<string, unknown>): SubscriberSocket => ({
    handshake: { auth },
    emit: emitSpy,
    disconnect: disconnectSpy,
    join: joinSpy,
  });

  // The subscriber path uses real JWTs in production, so the tests
  // sign a fresh access token via the same helper the auth router
  // does. The api's auth router is the system under test for these
  // tokens, not our subscriber module — we just need a valid one.
  const issueValidSessionToken = (): string =>
    issueAccessToken({ userId: "user-1", role: "Viewer" }).token;

  it("joins the readings:latest room when the session token is valid", async () => {
    const token = await issueValidSessionToken();
    const socket = buildSocket({ token });
    const joined = handleSubscriberConnection(socket);
    expect(joined).toBe(true);
    expect(joinSpy).toHaveBeenCalledWith("readings:latest");
    expect(emitSpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing auth token with 'unauthenticated' + disconnect", async () => {
    const socket = buildSocket({});
    const joined = handleSubscriberConnection(socket);
    expect(joined).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith("unauthenticated");
    expect(disconnectSpy).toHaveBeenCalledWith(true);
    expect(joinSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-string auth token", () => {
    const socket = buildSocket({ token: 42 });
    const joined = handleSubscriberConnection(socket);
    expect(joined).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith("unauthenticated");
    expect(disconnectSpy).toHaveBeenCalledWith(true);
  });

  it("rejects an invalid session JWT", () => {
    const socket = buildSocket({ token: "not.a.real.jwt" });
    const joined = handleSubscriberConnection(socket);
    expect(joined).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith("unauthenticated");
    expect(disconnectSpy).toHaveBeenCalledWith(true);
    expect(joinSpy).not.toHaveBeenCalled();
  });

  it("does not throw if the socket has no `join` (test fixture shape); success path still resolves true", async () => {
    const token = await issueValidSessionToken();
    const socket: SubscriberSocket = {
      handshake: { auth: { token } },
      emit: emitSpy,
      disconnect: disconnectSpy,
      // intentionally no `join`
    };
    const joined = handleSubscriberConnection(socket);
    expect(joined).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});
