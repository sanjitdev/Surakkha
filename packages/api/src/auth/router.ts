/**
 * Auth routes — Surakkha api (Story 1.4).
 *
 * Mounted by `packages/api/src/index.ts`. The route module is a plain
 * factory that returns handlers + a small typed `AuthDeps` interface so
 * unit tests can inject fakes for the audit logger and user store.
 *
 * Wire contract:
 *
 *   POST /auth/login
 *     body: { email, password }
 *     200 → { access_token, token_type: "Bearer", expires_in }
 *          Set-Cookie: surakkha_refresh=...; HttpOnly; SameSite=Strict;
 *                     Path=/auth; Secure (prod)
 *     401 → { error: "invalid_credentials" }   (no audit on failure)
 *     400 → { error: "validation_error", issues: [...] }
 *
 *   POST /auth/refresh
 *     body: (none)
 *     200 → new { access_token, token_type: "Bearer", expires_in }
 *     401 → { error: "invalid_refresh" }
 *
 * Story 1.4 AC: `// PUBLIC` markers on every login route so Story 1.5's
 * RBAC middleware skips them (architecture-appendix-rbac.md line 239).
 * Story 1.5 wire-up: the same intent is surfaced via `markPublic(handler)`
 * so a reviewer can see the bypass without scanning for the comment.
 */
import {
  type AccessToken,
  AccessTokenSchema,
  REFRESH_TOKEN_COOKIE,
  refreshTokenCookieOptions,
} from "@surakkha/shared/auth";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";


import { type AuditLogger } from "../audit";
import { markPublic } from "../middleware/authorize";

import { issueAccessToken, issueRefreshToken, verifyRefreshToken } from "./jwt";
import { findUserByEmail, findUserById, verifyPassword } from "./users";


const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;

const loginBodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export interface AuthDeps {
  readonly audit: AuditLogger;
}

export const buildAuthRouter = (deps: AuthDeps): Router => {
  const router = express.Router();

  // PUBLIC — login is the only way to obtain a token; Story 1.5's
  // RBAC middleware skips this route. `markPublic` sets req.public=true
  // so authenticate() tolerates an absent Authorization header.
  router.post(
    "/login",
    markPublic(async (req: Request, res: Response) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "validation_error",
          issues: parsed.error.issues,
        });
        return;
      }

      const { email, password } = parsed.data;
      const user = findUserByEmail(email);
      if (user === null) {
        // Do not write a login_failure audit on bad email — Story 1.4 AC
        // requires "no audit entry written on a wrong-password failure",
        // and we treat unknown email the same way (no enumeration leak).
        res.status(HTTP_UNAUTHORIZED).json({ error: "invalid_credentials" });
        return;
      }

      const passwordOk = await verifyPassword(user, password);
      if (!passwordOk) {
        res.status(HTTP_UNAUTHORIZED).json({ error: "invalid_credentials" });
        return;
      }

      const { token, expiresIn } = issueAccessToken({
        userId: user.id,
        role: user.role,
      });
      const refresh = issueRefreshToken(user.id);

      res.cookie(REFRESH_TOKEN_COOKIE, refresh, refreshTokenCookieOptions());
      const body: AccessToken = AccessTokenSchema.parse({
        access_token: token,
        token_type: "Bearer",
        expires_in: expiresIn,
      });
      deps.audit.emit({
        auditAction: "login_success",
        userId: user.id,
        outcome: "success",
      });
      res.status(HTTP_OK).json(body);
    }),
  );

  // PUBLIC — refresh uses the cookie, not an access token, so it must
  // skip the RBAC middleware. Story 1.7's interceptor hits this on
  // 60s-before-expiry.
  router.post(
    "/refresh",
    markPublic((req: Request, res: Response) => {
      const cookieValue = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (typeof cookieValue !== "string") {
        res.status(HTTP_UNAUTHORIZED).json({ error: "invalid_refresh" });
        return;
      }
      const verified = verifyRefreshToken(cookieValue);
      if (verified === null) {
        res.status(HTTP_UNAUTHORIZED).json({ error: "invalid_refresh" });
        return;
      }

      // Story 1.7: stamp the role into the new access token so the SPA
      // can decode role without an extra `/me` call. If the user has
      // been removed since the refresh token was issued, treat as
      // invalid_refresh (consistent with the orphaned-sub case in
      // `authenticate`).
      const user = findUserById(verified.userId);
      if (user === null) {
        res.status(HTTP_UNAUTHORIZED).json({ error: "invalid_refresh" });
        return;
      }

      const { token, expiresIn } = issueAccessToken({
        userId: verified.userId,
        role: user.role,
      });
      deps.audit.emit({
        auditAction: "token_refresh",
        userId: verified.userId,
        outcome: "success",
      });
      res.status(HTTP_OK).json({
        access_token: token,
        token_type: "Bearer",
        expires_in: expiresIn,
      });
    }),
  );

  return router;
};