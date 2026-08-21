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

  it("simulator audience: registers the frame listener and does NOT error/disconnect", async () => {
    const previousSecret = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = "x".repeat(64);
    try {
      const jwt = await import("jsonwebtoken");
      const token = jwt.default.sign(
        {
          iss: "surakkha-api",
          aud: "simulator",
          sub: DEVICE_UUID,
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

      // No auth error envelope and no disconnect.
      expect(rig.socket.emit).not.toHaveBeenCalled();
      expect(rig.socket.disconnect).not.toHaveBeenCalled();
      // The frame listener IS registered.
      const frameCall = rig.socket.on.mock.calls.find(
        (call: unknown[]) => call[0] === "frame",
      );
      expect(frameCall).toBeDefined();
    } finally {
      if (previousSecret === undefined) {
        delete process.env["JWT_SECRET"];
      } else {
        process.env["JWT_SECRET"] = previousSecret;
      }
    }
  });
});
