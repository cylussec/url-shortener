import { describe, it } from "vitest";
import { call, expectError, newUserToken } from "./helpers";

describe("error shape", () => {
  it("unknown route -> 404 not_found", async () => {
    await expectError(await call("/api/nope"), 404, "not_found");
    await expectError(await call("/"), 404, "not_found");
  });

  it("zod failure -> 400 invalid_request", async () => {
    await expectError(
      await call("/api/user/new", { method: "POST", json: { username: 1 } }),
      400,
      "invalid_request",
    );
  });

  it("malformed JSON -> 400 invalid_request", async () => {
    await expectError(
      await call("/api/user/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
      400,
      "invalid_request",
    );
  });

  it("oversized body -> 413 payload_too_large", async () => {
    const token = await newUserToken();
    await expectError(
      await call("/api/new", {
        method: "POST",
        token,
        json: { url: "https://big.example/" + "a".repeat(9000) },
      }),
      413,
      "payload_too_large",
    );
    await expectError(
      await call("/api/user/new", {
        method: "POST",
        json: { username: "x".repeat(9000), password: "y" },
      }),
      413,
      "payload_too_large",
    );
  });

  it("missing auth -> 401 unauthorized", async () => {
    await expectError(
      await call("/api/new", { method: "POST", json: { url: "https://a.example" } }),
      401,
      "unauthorized",
    );
  });
});
