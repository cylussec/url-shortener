import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "url_too_long"
  | "username_taken"
  | "invalid_credentials"
  | "unauthorized"
  | "rate_limited"
  | "payload_too_large"
  | "not_found"
  | "code_generation_failed"
  | "internal";

export type ErrorBody = { error: { code: ErrorCode; message: string } };

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
) {
  return c.json(errorBody(code, message), status);
}
