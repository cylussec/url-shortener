import { Hono } from "hono";
import type { Context } from "hono";
import { sha256hex } from "../lib/crypto";
import { apiError } from "../lib/errors";
import { CODE_PATTERN, shortcode } from "../lib/shortcode";
import { newUrlSchema, parseTargetUrl, validate } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/ratelimit";
import type { AppEnv } from "../types";

const MAX_INSERT_ATTEMPTS = 5;

type UrlRow = { code: string; original_url: string; created_at: number };

function shortUrl(c: Context<AppEnv>, code: string): string {
  return `${c.env.BASE_URL.replace(/\/+$/, "")}/${code}`;
}

function findExisting(db: D1Database, userId: number, urlHash: string) {
  return db
    .prepare("SELECT code, original_url, created_at FROM urls WHERE user_id = ? AND url_hash = ?")
    .bind(userId, urlHash)
    .first<UrlRow>();
}

export const apiUrlRoutes = new Hono<AppEnv>();

apiUrlRoutes.post(
  "/new",
  requireAuth,
  rateLimit("RL_NEW_URL", (c) => `user:${c.get("userId")}`),
  validate("json", newUrlSchema),
  async (c) => {
    const parsed = parseTargetUrl(c.req.valid("json").url);
    if (!parsed.ok) return apiError(c, 400, parsed.code, parsed.message);

    const db = c.env.DB;
    const userId = c.get("userId");
    const url = parsed.url;
    const urlHash = await sha256hex(url);
    const respond = (row: UrlRow, status: 200 | 201) =>
      c.json(
        {
          code: row.code,
          short_url: shortUrl(c, row.code),
          original_url: row.original_url,
          created_at: row.created_at,
        },
        status,
      );

    const existing = await findExisting(db, userId, urlHash);
    if (existing) return respond(existing, 200);

    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
      const code = shortcode.generate();
      const inserted = await db
        .prepare(
          "INSERT OR IGNORE INTO urls (code, user_id, original_url, url_hash) VALUES (?, ?, ?, ?) RETURNING code, created_at",
        )
        .bind(code, userId, url, urlHash)
        .first<{ code: string; created_at: number }>();
      if (inserted) return respond({ ...inserted, original_url: url }, 201);

      const duplicate = await findExisting(db, userId, urlHash);
      if (duplicate) return respond(duplicate, 200);
    }

    return apiError(c, 500, "code_generation_failed", "could not allocate a unique short code");
  },
);

apiUrlRoutes.get(`/read/:code{${CODE_PATTERN}}`, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT code, original_url, created_at FROM urls WHERE code = ?",
  )
    .bind(c.req.param("code"))
    .first<UrlRow>();
  if (!row) return apiError(c, 404, "not_found", "short code not found");
  return c.json(row);
});

export const redirectRoutes = new Hono<AppEnv>();

redirectRoutes.get(`/:code{${CODE_PATTERN}}`, async (c) => {
  const row = await c.env.DB.prepare("SELECT original_url FROM urls WHERE code = ?")
    .bind(c.req.param("code"))
    .first<{ original_url: string }>();
  if (!row) return apiError(c, 404, "not_found", "short code not found");
  return c.redirect(row.original_url, 302);
});
