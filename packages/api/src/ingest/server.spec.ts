/**
 * Story 2.2 — `buildIngestServer` connection handler.
 *
 * Mirrors the `frame.spec.ts` pattern: no supertest, no real
 * Socket.IO server. We construct a minimal socket stub that
 * exposes the surface the production handler reads (handshake.url,
 * handshake.auth, handshake.query, emit, disconnect, on, data)
 * and a stub `io` whose `to(room).emit(...)` is captured.
 *
 * Closes the I/O matrix gap: the spec's MISSING_TOKEN row was
 * uncovered until now. We also add a sub-mismatch test so the
 * `auth_error` / `device_id_mismatch` envelope is pinned.
 *
 * Covers the I/O matrix rows:
 *   - MISSING_TOKEN  → emits "unauthenticated", disconnects with 4401
 *   - sub mismatch   → emits "auth_error" with device_id_mismatch,
 *                     disconnects with 4401
 */
import { describe, expect, it, vi } from "vitest";

import { buildIngestServer } from "./server";
import { type ReadingRepository } from "./frame";

const DEVICE_UUID = "9b1c4f00-1234-4abc-9def-0123456789ab";
const OTHER_UUID = "9b1c4f00-1234-4abc-9def-0123456789cd";

interface StubSocket {
  readonly id: string;
  readonly handshake: {
    readonly url?: string;
    readonly auth?: Record<string, unknown>;
    readonly query?: Record<string, unknown>;
  };
  readonly on: ReturnType<typeof vi.fn>;
  readonly emit: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly data: Record<string, unknown>;
}

interface TestRig {
  readonly socket: StubSocket;
  readonly prisma: ReadingRepository;
  readonly prismaCreate: ReturnType<typeof vi.fn>;
  readonly io: ReturnType<typeof vi.fn>;
  readonly handler: (socket: unknown) => Promise<void>;
}

const buildRig = (socketOverrides: Partial<StubSocket> = {}): TestRig => {
  const ioEmit = vi.fn((_event: string, _payload: unknown) => undefined);
  const prismaCreate = vi.fn(async () => ({}));
  const prisma: ReadingRepository = {
    reading: { create: prismaCreate },
  };
  const socket: StubSocket = {
    id: "stub-socket",
    handshake: {},
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    data: {},
    ...socketOverrides,
  };
  const handler = buildIngestServer({
    io: {
      to() {
        return { emit: ioEmit };
      },
    },
    prisma,
  });
  return { socket, prisma, prismaCreate, io: ioEmit, handler };
};

describe("buildIngestServer — connection validation", () => {
  it("missing token: emits \"unauthenticated\" and disconnects with 4401", async () => {
    const rig = buildRig({
      handshake: {
        url: `/ingest/${DEVICE_UUID}`,
      },
    });

    await rig.handler(rig.socket);

    expect(rig.socket.emit).toHaveBeenCalledTimes(1);
    expect(rig.socket.emit).toHaveBeenCalledWith("unauthenticated");
    expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
    // No frame listener should be registered.
    expect(rig.socket.on).not.toHaveBeenCalled();
    // No row should ever be persisted.
    expect(rig.prismaCreate).not.toHaveBeenCalled();
  });

  it("sub mismatch: emits \"auth_error\" with device_id_mismatch and disconnects with 4401", async () => {
    const previousSecret = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = "x".repeat(64);
    try {
      const jwt = await import("jsonwebtoken");
      const token = jwt.default.sign(
        {
          iss: "surakkha-api",
          aud: "device",
          sub: OTHER_UUID,
          scope: "telemetry:write",
        },
        process.env["JWT_SECRET"] as string,
        { algorithm: "HS256", expiresIn: 3600 },
      );
      const rig = buildRig({
        handshake: {
          url: `/ingest/${DEVICE_UUID}`,
          auth: { token },
        },
      });

      await rig.handler(rig.socket);

      expect(rig.socket.emit).toHaveBeenCalledTimes(1);
      expect(rig.socket.emit).toHaveBeenCalledWith("auth_error", {
        error: "device_id_mismatch",
      });
      expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
      // No frame listener should be registered.
      expect(rig.socket.on).not.toHaveBeenCalled();
      // No row should ever be persisted.
      expect(rig.prismaCreate).not.toHaveBeenCalled();
      // No broadcast either.
      expect(rig.io).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) {
        delete process.env["JWT_SECRET"];
      } else {
        process.env["JWT_SECRET"] = previousSecret;
      }
    }
  });
});

/**
 * Story 2.2 — code review F-P12.
 *
 * The pre-existing tests cover MISSING_TOKEN and SUB_MISMATCH at the
 * connection layer, but the discriminated `VerifyIngestResult`
 * union (F-P1) introduced three more failure modes (sig_fail,
 * aud_fail, scope_fail) that must map to distinct envelopes at the
 * WS boundary. Pin each one here.
 *
 * The end-to-end listener invocation test closes the gap that the
 * "simulator audience" test only asserted `socket.on("frame")` was
 * called — it never invoked the registered handler to confirm
 * `processFrame` actually fires through.
 */
describe("buildIngestServer — discriminated failure envelopes", () => {
  type FrameListener = (raw: unknown) => Promise<void> | void;

  const signWithSecret = async (
    payload: Record<string, unknown>,
    secret: string,
  ): Promise<string> => {
    const jwt = await import("jsonwebtoken");
    return jwt.default.sign(payload, secret, {
      algorithm: "HS256",
      expiresIn: 3600,
    });
  };

  const withSecret = async <T>(
    body: () => Promise<T>,
  ): Promise<T> => {
    const previous = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = "x".repeat(64);
    try {
      return await body();
    } finally {
      if (previous === undefined) {
        delete process.env["JWT_SECRET"];
      } else {
        process.env["JWT_SECRET"] = previous;
      }
    }
  };

  it("signature failure (different secret) emits unauthenticated and disconnects", async () => {
    await withSecret(async () => {
      const wrongSecret = "y".repeat(64);
      const token = await signWithSecret(
        {
          iss: "surakkha-api",
          aud: "device",
          sub: DEVICE_UUID,
          scope: "telemetry:write",
        },
        wrongSecret,
      );
      const rig = buildRig({
        handshake: {
          url: `/ingest/${DEVICE_UUID}`,
          auth: { token },
        },
      });

      await rig.handler(rig.socket);

      expect(rig.socket.emit).toHaveBeenCalledWith("unauthenticated");
      expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
      expect(rig.socket.on).not.toHaveBeenCalled();
      expect(rig.prismaCreate).not.toHaveBeenCalled();
    });
  });

  it("aud=user emits unauthenticated and disconnects (never auth_error)", async () => {
    await withSecret(async () => {
      const token = await signWithSecret(
        {
          iss: "surakkha-api",
          aud: "user",
          sub: DEVICE_UUID,
          scope: "user:read",
        },
        process.env["JWT_SECRET"] as string,
      );
      const rig = buildRig({
        handshake: {
          url: `/ingest/${DEVICE_UUID}`,
          auth: { token },
        },
      });

      await rig.handler(rig.socket);

      // F-P1: aud_fail maps to the same `unauthenticated` envelope
      // as sig_fail — both mean "you are not allowed on this WS at
      // all". Only sub/scope surface the more specific `auth_error`.
      expect(rig.socket.emit).toHaveBeenCalledWith("unauthenticated");
      expect(rig.socket.emit).not.toHaveBeenCalledWith(
        "auth_error",
        expect.anything(),
      );
      expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
      expect(rig.socket.on).not.toHaveBeenCalled();
    });
  });

  it("scope mismatch emits auth_error forbidden_scope and disconnects", async () => {
    await withSecret(async () => {
      const token = await signWithSecret(
        {
          iss: "surakkha-api",
          aud: "device",
          sub: DEVICE_UUID,
          scope: "user:read",
        },
        process.env["JWT_SECRET"] as string,
      );
      const rig = buildRig({
        handshake: {
          url: `/ingest/${DEVICE_UUID}`,
          auth: { token },
        },
      });

      await rig.handler(rig.socket);

      // F-P1: scope_fail is its own envelope (not the same as a
      // wrong-device token). Operators reading the audit pipeline
      // can distinguish "device mis-configured its scope" from
      // "device trying to impersonate a different UUID".
      expect(rig.socket.emit).toHaveBeenCalledWith("auth_error", {
        error: "forbidden_scope",
      });
      expect(rig.socket.disconnect).toHaveBeenCalledWith(true);
      expect(rig.socket.on).not.toHaveBeenCalled();
    });
  });

  it("valid simulator token: registered frame listener processes a frame end-to-end", async () => {
    await withSecret(async () => {
      const token = await signWithSecret(
        {
          iss: "surakkha-api",
          aud: "simulator",
          sub: DEVICE_UUID,
          scope: "telemetry:write",
        },
        process.env["JWT_SECRET"] as string,
      );
      const rig = buildRig({
        handshake: {
          url: `/ingest/${DEVICE_UUID}`,
          auth: { token },
        },
      });

      await rig.handler(rig.socket);

      // F-P12(b): invoke the registered `frame` listener with a
      // valid payload and assert processFrame was reached — the
      // previous simulator test only verified registration.
      const frameCall = rig.socket.on.mock.calls.find(
        (call: unknown[]) => call[0] === "frame",
      );
      expect(frameCall).toBeDefined();
      const listener = frameCall?.[1] as FrameListener;
      expect(typeof listener).toBe("function");

      await listener({
        version: 1,
        device_id: DEVICE_UUID,
        // Story 2.3 — fresh ts so the stale-frame check in
        // stepValidate accepts the frame. The withSecret body uses
        // JWT_SECRET = "x".repeat(64) (no clock injection), so the
        // server-side `now()` defaults to real wall clock and the
        // frame's ts must be within the stale window. Tests that
        // need a specific skew override ts explicitly.
        ts: Date.now() - 1_000,
        fw: "1.0.3",
        seq: 0,
        metrics: {
          ph: 7.2,
          tds_ppm: 180,
          turbidity_ntu: 0.4,
          temp_c: 27.4,
          chlorine_ppm: 0.6,
          water_level_cm: 85,
        },
      });
      // The production handler is `(raw) => { processFrame(...).catch(...) }`
      // — the promise is fire-and-forget. Drain the microtask queue
      // so the awaited `prisma.reading.create` resolves before the
      // assertions below.
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Prisma row was persisted via the registered frame listener.
      expect(rig.prismaCreate).toHaveBeenCalledTimes(1);
      const [{ data }] = rig.prismaCreate.mock.calls[0]! as [
        { data: { deviceId: string; seq: number; flags: string[] } },
      ];
      expect(data.deviceId).toBe(DEVICE_UUID);
      expect(data.seq).toBe(0);
      expect(data.flags).toEqual([]);
      // Broadcast hit the room keyed by URL device_id.
      expect(rig.io).toHaveBeenCalledWith(
        "reading:new",
        expect.objectContaining({ device_id: DEVICE_UUID }),
      );
    });
  });
});
