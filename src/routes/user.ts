import { Hono } from "hono";
import {
  dummyVerify,
  generateToken,
  hashPassword,
  needsRehash,
  sha256hex,
  verifyPassword,
} from "../lib/crypto";
import { apiError } from "../lib/errors";
import { credentialsSchema, tokenRequestSchema, validate } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { clientIp, isRateLimited, rateLimit, rateLimited } from "../middleware/ratelimit";
import type { AppEnv } from "../types";

export const MAX_SESSIONS_PER_USER = 20;

export const userRoutes = new Hono<AppEnv>();

userRoutes.post(
  "/new",
  rateLimit("RL_USER_NEW_IP", (c) => `ip:${clientIp(c)}`),
  validate("json", credentialsSchema),
  async (c) => {
    const { username, password } = c.req.valid("json");
    const passwordHash = await hashPassword(password);
    const row = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username",
    )
      .bind(username, passwordHash)
      .first<{ id: number; username: string }>();
    if (!row) return apiError(c, 409, "username_taken", "username is already taken");
    return c.json({ id: row.id, username: row.username }, 201);
  },
);

userRoutes.post(
  "/token",
  rateLimit("RL_TOKEN_IP", (c) => `ip:${clientIp(c)}`),
  validate("json", tokenRequestSchema),
  async (c) => {
    const { username, password, expires_in } = c.req.valid("json");
    if (await isRateLimited(c.env, "RL_TOKEN_USER", `user:${username}`)) return rateLimited(c);

    const db = c.env.DB;
    const user = await db
      .prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .bind(username)
      .first<{ id: number; password_hash: string }>();
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await dummyVerify(password);
    if (!user || !ok) {
      return apiError(c, 401, "invalid_credentials", "invalid username or password");
    }

    if (needsRehash(user.password_hash)) {
      const rehashed = await hashPassword(password);
      await db
        .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(rehashed, user.id)
        .run();
    }

    const token = generateToken();
    const tokenHash = await sha256hex(token);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = expires_in === undefined ? null : now + expires_in;

    await db.batch([
      db
        .prepare(
          "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        )
        .bind(tokenHash, user.id, now, expiresAt),
      db
        .prepare(
          "DELETE FROM sessions WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?",
        )
        .bind(user.id, now),
      db
        .prepare(
          `DELETE FROM sessions WHERE user_id = ?1 AND rowid NOT IN (
             SELECT rowid FROM sessions WHERE user_id = ?1
             ORDER BY created_at DESC, rowid DESC LIMIT ?2
           )`,
        )
        .bind(user.id, MAX_SESSIONS_PER_USER),
    ]);

    return c.json({ token, expires_at: expiresAt }, 201);
  },
);

userRoutes.delete("/token", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(c.get("tokenHash"))
    .run();
  return c.body(null, 204);
});

userRoutes.delete("/tokens", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c.get("userId")).run();
  return c.body(null, 204);
});
