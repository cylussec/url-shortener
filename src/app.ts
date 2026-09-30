import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError } from "./lib/errors";
import { apiUrlRoutes, redirectRoutes } from "./routes/urls";
import { userRoutes } from "./routes/user";
import type { AppEnv } from "./types";

export const MAX_BODY_BYTES = 8 * 1024;

export const app = new Hono<AppEnv>();

app.use(
  "*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      apiError(c, 413, "payload_too_large", `body must be at most ${MAX_BODY_BYTES} bytes`),
  }),
);

app.route("/api/user", userRoutes);
app.route("/api", apiUrlRoutes);
app.route("/", redirectRoutes);

app.notFound((c) => apiError(c, 404, "not_found", "not found"));

app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) {
    return apiError(
      c,
      err.status as ContentfulStatusCode,
      "invalid_request",
      err.message || "invalid request",
    );
  }
  console.error(err);
  return apiError(c, 500, "internal", "internal server error");
});
