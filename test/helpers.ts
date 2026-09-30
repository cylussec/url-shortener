import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { app } from "../src/app";
import type { RateLimiterName } from "../src/middleware/ratelimit";
import type { Bindings } from "../src/types";

export const allowAll: RateLimit = { limit: async () => ({ success: true }) };
export const denyAll: RateLimit = { limit: async () => ({ success: false }) };

export function testEnv(overrides: Partial<Record<RateLimiterName, RateLimit>> = {}): Bindings {
  return {
    DB: env.DB,
    BASE_URL: "https://sho.rt",
    RL_USER_NEW_IP: allowAll,
    RL_TOKEN_IP: allowAll,
    RL_TOKEN_USER: allowAll,
    RL_NEW_URL: allowAll,
    ...overrides,
  };
}

export async function call(
  path: string,
  init: RequestInit & { json?: unknown; token?: string } = {},
  bindings: Bindings = testEnv(),
): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://localhost${path}`, { ...init, headers, body, redirect: "manual" }),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let counter = 0;
export function uniqueUsername(prefix = "user"): string {
  counter++;
  return `${prefix}_${counter}_${Math.floor(Math.random() * 1e6)}`;
}

export const PASSWORD = "correct horse battery";

export async function createUser(username = uniqueUsername()): Promise<string> {
  const res = await call("/api/user/new", {
    method: "POST",
    json: { username, password: PASSWORD },
  });
  expect(res.status).toBe(201);
  return username;
}

export async function getToken(username: string, expiresIn?: number): Promise<string> {
  const res = await call("/api/user/token", {
    method: "POST",
    json: { username, password: PASSWORD, expires_in: expiresIn },
  });
  expect(res.status).toBe(201);
  const body = await res.json<{ token: string }>();
  return body.token;
}

export async function newUserToken(): Promise<string> {
  return getToken(await createUser());
}

export async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json<{ error: { code: string; message: string } }>();
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
}

export async function shorten(token: string, url: string): Promise<Response> {
  return call("/api/new", { method: "POST", token, json: { url } });
}
