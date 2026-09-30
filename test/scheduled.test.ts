import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { createUser } from "./helpers";

describe("scheduled purge", () => {
  it("deletes only expired sessions", async () => {
    const name = await createUser();
    const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(name)
      .first<{ id: number }>();
    const id = user?.id;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NULL)",
      ).bind("never", id),
      env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, unixepoch() + 3600)",
      ).bind("future", id),
      env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, unixepoch() - 1)",
      ).bind("past", id),
      env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, unixepoch())",
      ).bind("now", id),
    ]);

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "17 3 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    const { results } = await env.DB.prepare(
      "SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY token_hash",
    )
      .bind(id)
      .all<{ token_hash: string }>();
    expect(results.map((r) => r.token_hash)).toEqual(["future", "never"]);
  });
});
