import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError } from "../lib/errors";
import type { AppEnv, Bindings } from "../types";

export type RateLimiterName = "RL_USER_NEW_IP" | "RL_TOKEN_IP" | "RL_TOKEN_USER" | "RL_NEW_URL";

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

export async function isRateLimited(
  env: Bindings,
  name: RateLimiterName,
  key: string,
): Promise<boolean> {
  const { success } = await env[name].limit({ key });
  return !success;
}

export function rateLimited(c: Context<AppEnv>) {
  return apiError(c, 429, "rate_limited", "too many requests, slow down");
}

export function rateLimit(name: RateLimiterName, keyFn: (c: Context<AppEnv>) => string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (await isRateLimited(c.env, name, keyFn(c))) return rateLimited(c);
    await next();
  });
}
