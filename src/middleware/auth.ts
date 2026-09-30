import { createMiddleware } from "hono/factory";
import { apiError } from "../lib/errors";
import { sha256hex } from "../lib/crypto";
import type { AppEnv } from "../types";

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return apiError(c, 401, "unauthorized", "missing or malformed bearer token");

  const tokenHash = await sha256hex(match[1]);
  const row = await c.env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > unixepoch())",
  )
    .bind(tokenHash)
    .first<{ user_id: number }>();
  if (!row) return apiError(c, 401, "unauthorized", "invalid or expired token");

  c.set("userId", row.user_id);
  c.set("tokenHash", tokenHash);
  await next();
});
