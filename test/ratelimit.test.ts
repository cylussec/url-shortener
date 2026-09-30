import { describe, expect, it, vi } from "vitest";
import { PASSWORD, call, createUser, expectError, getToken, testEnv, denyAll } from "./helpers";

function recorder() {
  const keys: string[] = [];
  const limiter: RateLimit = {
    limit: vi.fn(async ({ key }: RateLimitOptions) => {
      keys.push(key);
      return { success: true };
    }),
  };
  return { keys, limiter };
}

describe("rate limiting", () => {
  it("POST /api/user/new is limited per IP", async () => {
    const { keys, limiter } = recorder();
    const res = await call(
      "/api/user/new",
      {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.7" },
        json: { username: "rluser1", password: PASSWORD },
      },
      testEnv({ RL_USER_NEW_IP: limiter }),
    );
    expect(res.status).toBe(201);
    expect(keys).toEqual(["ip:203.0.113.7"]);

    await expectError(
      await call(
        "/api/user/new",
        { method: "POST", json: { username: "rluser2", password: PASSWORD } },
        testEnv({ RL_USER_NEW_IP: denyAll }),
      ),
      429,
      "rate_limited",
    );
  });

  it("POST /api/user/token is limited per IP and per username", async () => {
    const name = await createUser();
    const ip = recorder();
    const user = recorder();
    const res = await call(
      "/api/user/token",
      {
        method: "POST",
        headers: { "cf-connecting-ip": "198.51.100.1" },
        json: { username: name.toUpperCase(), password: PASSWORD },
      },
      testEnv({ RL_TOKEN_IP: ip.limiter, RL_TOKEN_USER: user.limiter }),
    );
    expect(res.status).toBe(201);
    expect(ip.keys).toEqual(["ip:198.51.100.1"]);
    expect(user.keys).toEqual([`user:${name}`]);

    for (const denied of [{ RL_TOKEN_IP: denyAll }, { RL_TOKEN_USER: denyAll }]) {
      await expectError(
        await call(
          "/api/user/token",
          { method: "POST", json: { username: name, password: PASSWORD } },
          testEnv(denied),
        ),
        429,
        "rate_limited",
      );
    }
  });

  it("POST /api/new is limited per user", async () => {
    const token = await getToken(await createUser());
    const { keys, limiter } = recorder();
    const res = await call(
      "/api/new",
      { method: "POST", token, json: { url: "https://rl.example/" } },
      testEnv({ RL_NEW_URL: limiter }),
    );
    expect(res.status).toBe(201);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^user:\d+$/);

    await expectError(
      await call(
        "/api/new",
        { method: "POST", token, json: { url: "https://rl.example/2" } },
        testEnv({ RL_NEW_URL: denyAll }),
      ),
      429,
      "rate_limited",
    );
  });

  it("the real binding is wired in wrangler config", async () => {
    const { env } = await import("cloudflare:workers");
    const result = await env.RL_NEW_URL.limit({ key: "wiring-check" });
    expect(result.success).toBe(true);
  });
});
