import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";
import { apiError } from "./errors";

export const MAX_URL_LENGTH = 4096;
export const MAX_EXPIRES_IN = 31_536_000;
export const MIN_EXPIRES_IN = 60;

export const usernameSchema = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(
    z.string().regex(/^[a-z0-9_-]{3,32}$/, "username must be 3-32 characters of a-z, 0-9, _ or -"),
  );

export const passwordSchema = z
  .string()
  .min(8, "password must be at least 8 characters")
  .max(128, "password must be at most 128 characters");

export const credentialsSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const tokenRequestSchema = credentialsSchema.extend({
  expires_in: z.number().int().min(MIN_EXPIRES_IN).max(MAX_EXPIRES_IN).optional(),
});

export const newUrlSchema = z.object({ url: z.string() });

export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return apiError(c, 400, "invalid_request", `${path}${issue?.message ?? "invalid request"}`);
    }
  });
}

export type UrlParseResult =
  { ok: true; url: string } | { ok: false; code: "invalid_url" | "url_too_long"; message: string };

export function parseTargetUrl(input: string): UrlParseResult {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, code: "invalid_url", message: "url must be an absolute http(s) URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "invalid_url", message: "only http and https URLs are allowed" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, code: "invalid_url", message: "URLs with credentials are not allowed" };
  }
  const href = parsed.href;
  if (href.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      code: "url_too_long",
      message: `url must be at most ${MAX_URL_LENGTH} characters`,
    };
  }
  return { ok: true, url: href };
}
