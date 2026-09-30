import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcode } from "../src/lib/shortcode";
import { call, expectError, newUserToken, shorten } from "./helpers";

type ShortenBody = { code: string; short_url: string; original_url: string; created_at: number };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/new", () => {
  it("creates a short code", async () => {
    const token = await newUserToken();
    const res = await shorten(token, "https://example.com/path?q=1#frag");
    expect(res.status).toBe(201);
    const body = await res.json<ShortenBody>();
    expect(body.code).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(body.short_url).toBe(`https://sho.rt/${body.code}`);
    expect(body.original_url).toBe("https://example.com/path?q=1#frag");
    expect(body.created_at).toEqual(expect.any(Number));
  });

  it("returns the same code with 200 for a duplicate", async () => {
    const token = await newUserToken();
    const first = await (await shorten(token, "https://dup.example/a")).json<ShortenBody>();
    const res = await shorten(token, "https://dup.example/a");
    expect(res.status).toBe(200);
    expect(await res.json<ShortenBody>()).toEqual(first);
  });

  it("gives different users different codes for the same URL", async () => {
    const a = await (
      await shorten(await newUserToken(), "https://same.example/")
    ).json<ShortenBody>();
    const b = await (
      await shorten(await newUserToken(), "https://same.example/")
    ).json<ShortenBody>();
    expect(a.code).not.toBe(b.code);
  });

  it("dedups https://x and https://x/", async () => {
    const token = await newUserToken();
    const a = await (await shorten(token, "https://slash.example")).json<ShortenBody>();
    const res = await shorten(token, "https://slash.example/");
    expect(res.status).toBe(200);
    const b = await res.json<ShortenBody>();
    expect(b.code).toBe(a.code);
    expect(a.original_url).toBe("https://slash.example/");
  });

  it("keeps http and https distinct", async () => {
    const token = await newUserToken();
    const a = await (await shorten(token, "http://scheme.example/")).json<ShortenBody>();
    const b = await (await shorten(token, "https://scheme.example/")).json<ShortenBody>();
    expect(a.code).not.toBe(b.code);
  });

  it("lowercases scheme and host and drops default ports", async () => {
    const token = await newUserToken();
    const body = await (await shorten(token, "HTTPS://Case.Example:443/Path")).json<ShortenBody>();
    expect(body.original_url).toBe("https://case.example/Path");
  });

  it("serializes IDN hosts to punycode", async () => {
    const token = await newUserToken();
    const body = await (await shorten(token, "https://bücher.example/")).json<ShortenBody>();
    expect(body.original_url).toBe("https://xn--bcher-kva.example/");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["ftp:", "ftp://files.example/x"],
    ["relative", "hello"],
    ["userinfo", "https://user:pass@host.example/"],
    ["username only", "https://bank.example@evil.example/"],
  ])("rejects %s URLs", async (_label, url) => {
    const token = await newUserToken();
    await expectError(await shorten(token, url), 400, "invalid_url");
  });

  it("rejects URLs longer than 4096 characters", async () => {
    const token = await newUserToken();
    const prefix = "https://long.example/";
    const ok = prefix + "a".repeat(4096 - prefix.length);
    expect((await shorten(token, ok)).status).toBe(201);
    await expectError(await shorten(token, ok + "a"), 400, "url_too_long");
  });

  it("measures length on the serialized href", async () => {
    const token = await newUserToken();
    const prefix = "https://long.example/";
    // Each space becomes %20 when serialized.
    const url = prefix + " ".repeat(1400) + "x";
    await expectError(await shorten(token, url), 400, "url_too_long");
  });

  it("rejects a missing or non-string url", async () => {
    const token = await newUserToken();
    await expectError(
      await call("/api/new", { method: "POST", token, json: {} }),
      400,
      "invalid_request",
    );
    await expectError(
      await call("/api/new", { method: "POST", token, json: { url: 42 } }),
      400,
      "invalid_request",
    );
  });

  it("returns one code for parallel duplicate requests", async () => {
    const token = await newUserToken();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => shorten(token, "https://parallel.example/")),
    );
    const bodies = await Promise.all(responses.map((r) => r.json<ShortenBody>()));
    expect(new Set(bodies.map((b) => b.code)).size).toBe(1);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(7);
  });

  it("retries on code collision and fails with code_generation_failed", async () => {
    const token = await newUserToken();
    const spy = vi.spyOn(shortcode, "generate").mockReturnValue("FIXEDcode");
    expect((await shorten(token, "https://first.example/")).status).toBe(201);
    await expectError(
      await shorten(token, "https://second.example/"),
      500,
      "code_generation_failed",
    );
    expect(spy).toHaveBeenCalledTimes(1 + 5);
  });

  it("recovers from a single code collision", async () => {
    const token = await newUserToken();
    const first = await (await shorten(token, "https://c1.example/")).json<ShortenBody>();
    vi.spyOn(shortcode, "generate")
      .mockReturnValueOnce(first.code)
      .mockReturnValueOnce("NEWcode42");
    const res = await shorten(token, "https://c2.example/");
    expect(res.status).toBe(201);
    expect((await res.json<ShortenBody>()).code).toBe("NEWcode42");
  });
});

describe("GET /api/read/:code", () => {
  it("returns the stored URL", async () => {
    const token = await newUserToken();
    const created = await (await shorten(token, "https://read.example/x")).json<ShortenBody>();
    const res = await call(`/api/read/${created.code}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: created.code,
      original_url: "https://read.example/x",
      created_at: created.created_at,
    });
  });

  it("returns 404 for unknown and malformed codes", async () => {
    await expectError(await call("/api/read/AAAAAAAAA"), 404, "not_found");
    await expectError(await call("/api/read/short"), 404, "not_found");
    await expectError(await call("/api/read/has-dash!"), 404, "not_found");
  });
});

describe("GET /:code", () => {
  it("redirects with 302", async () => {
    const token = await newUserToken();
    const created = await (await shorten(token, "https://go.example/landing")).json<ShortenBody>();
    const res = await call(`/${created.code}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://go.example/landing");
  });

  it("supports HEAD", async () => {
    const token = await newUserToken();
    const created = await (await shorten(token, "https://head.example/")).json<ShortenBody>();
    const res = await call(`/${created.code}`, { method: "HEAD" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://head.example/");
  });

  it("produces a valid Location for non-ASCII input", async () => {
    const token = await newUserToken();
    const created = await (await shorten(token, "https://例え.jp/パス?q=値 x")).json<ShortenBody>();
    const res = await call(`/${created.code}`);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toBe(created.original_url);
    expect(location).toMatch(/^[\x21-\x7e]+$/);
    expect(new URL(location).hostname).toBe("xn--r8jz45g.jp");
  });

  it("returns 404 for unknown and malformed codes", async () => {
    await expectError(await call("/ZZZZZZZZZ"), 404, "not_found");
    await expectError(await call("/tooshort"), 404, "not_found");
    await expectError(await call("/toolongcode1"), 404, "not_found");
  });
});
