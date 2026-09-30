import type { Bindings } from "./types";

export async function purgeExpiredSessions(db: D1Database): Promise<number> {
  const result = await db
    .prepare("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= unixepoch()")
    .run();
  return result.meta.changes;
}

export const scheduled: ExportedHandlerScheduledHandler<Bindings> = (_controller, env, ctx) => {
  ctx.waitUntil(purgeExpiredSessions(env.DB));
};
