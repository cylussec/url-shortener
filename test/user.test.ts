import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256hex } from "../src/lib/crypto";
import { MAX_SESSIONS_PER_USER } from "../src/routes/user";
import {
  PASSWORD,
  call,
  createUser,
  expectError,
  getToken,
  shorten,
  uniqueUsername,
} from "./helpers";

describe("POST /api/user/new", () => {
  it("creates a user with a lowercased username", async () => {
    const name = uniqueUsername("MixedCase");
    const res = await call("/api/user/new", {
      method: "POST",
      json: { username: name, password: PASSWORD },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: number; username: string }>();
    expect(body.username).toBe(name.toLowerCase());
    expect(body.id).toEqual(expect.any(Number));
  });

  it("returns 409 for a taken username, case-insensitively", async () => {
    const name = await createUser();
    const res = await call("/api/user/new", {
      method: "POST",
      json: { username: name.toUpperCase(), password: PASSWORD },
    });
    await expectError(res, 409, "username_taken");
  });

  it.each([
    ["too short username", { username: "ab", password: PASSWORD }],
    ["bad username charset", { username: "bad name!", password: PASSWORD }],
    ["too long username", { username: "a".repeat(33), password: PASSWORD }],
    ["short password", { username: "validname", password: "1234567" }],
    ["long password", { username: "validname", password: "x".repeat(129) }],
    ["missing fields", {}],
  ])("rejects %s", async (_label, json) => {
    const res = await call("/api/user/new", { method: "POST", json });
    await expectError(res, 400, "invalid_request");
  });

  it("stores a pbkdf2 hash, not the password", async () => {
    const name = await createUser();
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE username = ?")
      .bind(name)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$\d+\$[^$]+\$[^$]+$/);
    expect(row?.password_hash).not.toContain(PASSWORD);
  });
});

describe("POST /api/user/token", () => {
  it("issues a non-expiring token by default", async () => {
    const name = await createUser();
    const res = await call("/api/user/token", {
      method: "POST",
      json: { username: name, password: PASSWORD },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ token: string; expires_at: number | null }>();
    expect(body.expires_at).toBeNull();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await env.DB.prepare("SELECT token_hash FROM sessions WHERE token_hash = ?")
      .bind(await sha256hex(body.token))
      .first();
    expect(stored).not.toBeNull();
  });

  it("accepts a username in any case", async () => {
    const name = await createUser();
    const res = await call("/api/user/token", {
      method: "POST",
      json: { username: name.toUpperCase(), password: PASSWORD },
    });
    expect(res.status).toBe(201);
  });

  it("sets expires_at from expires_in", async () => {
    const name = await createUser();
    const before = Math.floor(Date.now() / 1000);
    const res = await call("/api/user/token", {
      method: "POST",
      json: { username: name, password: PASSWORD, expires_in: 3600 },
    });
    const body = await res.json<{ expires_at: number }>();
    expect(body.expires_at).toBeGreaterThanOrEqual(before + 3600);
    expect(body.expires_at).toBeLessThanOrEqual(before + 3601);
  });

  it("rejects a wrong password", async () => {
    const name = await createUser();
    const res = await call("/api/user/token", {
      method: "POST",
      json: { username: name, password: "wrong password" },
    });
    await expectError(res, 401, "invalid_credentials");
  });

  it("rejects an unknown user with the same error", async () => {
    const res = await call("/api/user/token", {
      method: "POST",
      json: { username: uniqueUsername("ghost"), password: PASSWORD },
    });
    await expectError(res, 401, "invalid_credentials");
  });

  it.each([
    ["zero", 0],
    ["negative", -60],
    ["float", 120.5],
    ["above one year", 31_536_001],
    ["below minimum", 59],
    ["string", "3600"],
    ["null", null],
  ])("rejects expires_in %s", async (_label, expires_in) => {
    const name = await createUser();
    const res = await call("/api/user/token", {
      method: "POST",
      json: { username: name, password: PASSWORD, expires_in },
    });
    await expectError(res, 400, "invalid_request");
  });

  it("accepts the expires_in bounds", async () => {
    const name = await createUser();
    for (const expires_in of [60, 31_536_000]) {
      const res = await call("/api/user/token", {
        method: "POST",
        json: { username: name, password: PASSWORD, expires_in },
      });
      expect(res.status).toBe(201);
    }
  });

  it("prunes the oldest session beyond the per-user cap", async () => {
    const name = await createUser();
    const tokens: string[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 1; i++) tokens.push(await getToken(name));

    const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(name)
      .first<{ id: number }>();
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .bind(user?.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(MAX_SESSIONS_PER_USER);

    await expectError(await shorten(tokens[0], "https://example.com/"), 401, "unauthorized");
    expect((await shorten(tokens[1], "https://example.com/")).status).toBe(201);
    expect((await shorten(tokens[MAX_SESSIONS_PER_USER], "https://example.com/")).status).toBe(200);
  });

  it("deletes the user's expired sessions when issuing a token", async () => {
    const name = await createUser();
    const old = await getToken(name, 60);
    await env.DB.prepare("UPDATE sessions SET expires_at = unixepoch() - 1 WHERE token_hash = ?")
      .bind(await sha256hex(old))
      .run();
    await getToken(name);
    const row = await env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash = ?")
      .bind(await sha256hex(old))
      .first();
    expect(row).toBeNull();
  });
});

describe("auth middleware", () => {
  it("rejects missing, malformed and unknown tokens", async () => {
    await expectError(
      await call("/api/new", { method: "POST", json: { url: "https://a.example" } }),
      401,
      "unauthorized",
    );
    await expectError(
      await call("/api/new", {
        method: "POST",
        headers: { Authorization: "Basic abc" },
        json: { url: "https://a.example" },
      }),
      401,
      "unauthorized",
    );
    await expectError(await shorten("not-a-real-token", "https://a.example"), 401, "unauthorized");
  });

  it("rejects an expired token", async () => {
    const name = await createUser();
    const token = await getToken(name, 60);
    expect((await shorten(token, "https://a.example")).status).toBe(201);
    await env.DB.prepare("UPDATE sessions SET expires_at = unixepoch() - 1 WHERE token_hash = ?")
      .bind(await sha256hex(token))
      .run();
    await expectError(await shorten(token, "https://a.example"), 401, "unauthorized");
  });

  it("ignores any user id in the body", async () => {
    const a = await createUser();
    const tokenA = await getToken(a);
    const res = await call("/api/new", {
      method: "POST",
      token: tokenA,
      json: { url: "https://body-user.example/", user_id: 999999 },
    });
    expect(res.status).toBe(201);
    const { code } = await res.json<{ code: string }>();
    const row = await env.DB.prepare(
      "SELECT u.username FROM urls JOIN users u ON u.id = urls.user_id WHERE code = ?",
    )
      .bind(code)
      .first<{ username: string }>();
    expect(row?.username).toBe(a);
  });
});

describe("token revocation", () => {
  it("DELETE /api/user/token revokes only the current token", async () => {
    const name = await createUser();
    const t1 = await getToken(name);
    const t2 = await getToken(name);
    const res = await call("/api/user/token", { method: "DELETE", token: t1 });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    await expectError(await shorten(t1, "https://a.example"), 401, "unauthorized");
    expect((await shorten(t2, "https://a.example")).status).toBe(201);
  });

  it("DELETE /api/user/tokens revokes all of the user's tokens only", async () => {
    const name = await createUser();
    const t1 = await getToken(name);
    const t2 = await getToken(name);
    const other = await getToken(await createUser());
    const res = await call("/api/user/tokens", { method: "DELETE", token: t1 });
    expect(res.status).toBe(204);
    await expectError(await shorten(t1, "https://a.example"), 401, "unauthorized");
    await expectError(await shorten(t2, "https://a.example"), 401, "unauthorized");
    expect((await shorten(other, "https://a.example")).status).toBe(201);
  });

  it("requires auth", async () => {
    await expectError(await call("/api/user/token", { method: "DELETE" }), 401, "unauthorized");
    await expectError(await call("/api/user/tokens", { method: "DELETE" }), 401, "unauthorized");
  });
});
