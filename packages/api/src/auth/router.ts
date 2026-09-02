/**
 * Auth routes — Surakkha api.
 *
 * Mounted by `packages/api/src/index.ts`. Returns an Express router plus
 * a small typed `AuthDeps` interface so unit tests can inject fakes for
 * the audit logger.
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
import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_OK, HTTP_UNAUTHORIZED } from "../httpStatus.js";
import { markPublic } from "../middleware/authorize";

import { issueAccessToken, issueRefreshToken, verifyRefreshToken } from "./jwt";
import { findUserByEmail, findUserById, verifyPassword } from "./users";

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

  router.post(
    "/login",
    markPublic(async (req: Request, res: Response) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.VALIDATION_ERROR.value,
          issues: parsed.error.issues,
        });
        return;
      }

      const { email, password } = parsed.data;
      const user = findUserByEmail(email);
      if (user === null) {
        res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.INVALID_CREDENTIALS.value });
        return;
      }

      const passwordOk = await verifyPassword(user, password);
      if (!passwordOk) {
        res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.INVALID_CREDENTIALS.value });
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

  router.post(
    "/refresh",
    markPublic((req: Request, res: Response) => {
      const cookieValue = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (typeof cookieValue !== "string") {
        res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.INVALID_REFRESH.value });
        return;
      }
      const verified = verifyRefreshToken(cookieValue);
      if (verified === null) {
        res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.INVALID_REFRESH.value });
        return;
      }

      const user = findUserById(verified.userId);
      if (user === null) {
        res.status(HTTP_UNAUTHORIZED).json({ error: ERROR_CODES.INVALID_REFRESH.value });
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
