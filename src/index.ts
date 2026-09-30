import { app } from "./app";
import { scheduled } from "./scheduled";
import type { Bindings } from "./types";

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
