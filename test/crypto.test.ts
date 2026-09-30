import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_SUPPORTED_ITERATIONS,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "../src/lib/crypto";
import { shortcode } from "../src/lib/shortcode";

describe("crypto", () => {
  it("hashes and verifies passwords", async () => {
    const stored = await hashPassword("s3cret password");
    expect(stored.startsWith(`pbkdf2-sha256$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(await verifyPassword("s3cret password", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("keeps iterations within the workerd ceiling", () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(PBKDF2_MAX_SUPPORTED_ITERATIONS);
  });

  it("verifies hashes made with a different iteration count", async () => {
    const stored = await hashPassword("pw12345678", 1000);
    expect(await verifyPassword("pw12345678", stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
    expect(needsRehash(await hashPassword("pw12345678"))).toBe(false);
  });
});

describe("shortcode", () => {
  it("generates 9-char alphanumeric codes", () => {
    const codes = new Set(Array.from({ length: 500 }, () => shortcode.generate()));
    expect(codes.size).toBe(500);
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{9}$/);
  });
});
