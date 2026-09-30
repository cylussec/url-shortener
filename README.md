# url-shortener

API-only URL shortener on Cloudflare Workers (Free plan): TypeScript, Hono, D1. POC-grade security.

## API

All API routes live under `/api/`; the root path space is reserved for short codes. Timestamps are Unix seconds.

| Method & path             | Auth   | Body                                | Success                                                                  |
| ------------------------- | ------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/user/new`      | –      | `{username, password}`              | `201 {id, username}`                                                     |
| `POST /api/user/token`    | –      | `{username, password, expires_in?}` | `201 {token, expires_at}` (`null` = never expires)                       |
| `DELETE /api/user/token`  | Bearer | –                                   | `204` (revokes the current token)                                        |
| `DELETE /api/user/tokens` | Bearer | –                                   | `204` (revokes all of the user's tokens)                                 |
| `POST /api/new`           | Bearer | `{url}`                             | `201 {code, short_url, original_url, created_at}`; `200` for a duplicate |
| `GET /api/read/:code`     | –      | –                                   | `200 {code, original_url, created_at}`                                   |
| `GET\|HEAD /:code`        | –      | –                                   | `302 Location: <original_url>`                                           |

Errors always look like `{ "error": { "code": "...", "message": "..." } }`. Codes: `invalid_request`,
`invalid_url`, `url_too_long`, `username_taken`, `invalid_credentials`, `unauthorized`, `rate_limited`,
`payload_too_large`, `not_found`, `code_generation_failed`, `internal`.

Rules:

- Usernames are lowercased, then must match `^[a-z0-9_-]{3,32}$`. Passwords are 8–128 characters.
- `expires_in` is an optional integer from 60 to 31,536,000. At most 20 sessions per user; the oldest is pruned.
- Codes are 9 characters of `[A-Za-z0-9]`. Same user + same URL returns the same code.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars          # BASE_URL=http://localhost:8787 for local short_url values
npm run db:migrate:local                # wrangler d1 migrations apply url-shortener --local
npm run dev                             # wrangler dev on http://localhost:8787
```

Checks:

```sh
npm run typecheck
npm run lint
npm test                                # vitest in workerd (Miniflare) with a real local D1
npm run bruno                           # Bruno collection against the local dev server
```

The full Bruno run creates a new permanent user each time, so run it **locally only**. Requests run in
order: `bruno/happy-path/` first (it sets `username`, `token`, `expiringToken`, `code`), then `bruno/errors/`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create url-shortener    # put the printed database_id into wrangler.jsonc
# set vars.BASE_URL in wrangler.jsonc to the public URL (workers.dev or custom domain)
npm run db:migrate:remote
npm run deploy
```

Prod smoke test with a pre-made account: copy `bruno/.env.example` to `bruno/.env`, fill it in, then

```sh
cd bruno && npx bru run "happy-path/02 Get Token.bru" "happy-path/04 Shorten URL.bru" \
  "happy-path/07 Read.bru" "happy-path/08 Redirect.bru" --env prod
```

A daily cron (`17 3 * * *`) purges expired sessions.

## Known POC limitations

- **Password hashing strength.** PBKDF2-SHA256 must fit the Free plan's 10 ms CPU limit (workerd also caps
  it at 100k iterations), so `PBKDF2_ITERATIONS` in `src/lib/crypto.ts` is far below OWASP's ~600k. It is
  currently a **placeholder (20,000)** until the deployed benchmark is run: deploy, then watch `cpuTime`
  for `POST /api/user/token` in Workers Logs / `wrangler tail` at several iteration counts, and pick the
  highest count with p99 CPU ≤ ~7 ms. Set `PBKDF2_CPU_BUDGET_ITERATIONS` to what one request can afford;
  rehash-on-login only runs when `stored + current` fits that budget, so on the Free plan it usually skips.
  The iteration count is stored in each hash, so raising it later is safe.
- **Rate limits are best effort.** They use the Workers Rate Limiting binding, which is per-location and
  eventually consistent. Limits: `/api/user/new` 5/60 s per IP, `/api/user/token` 10/60 s per IP and per
  username, `/api/new` 60/60 s per user. Request bodies are capped at 8 KB.
- **URL serialization.** Stored and redirected URLs are WHATWG `new URL(input).href`: scheme and host are
  lowercased, IDN hosts become punycode, default ports are dropped, an empty path becomes `/` (so
  `https://x` and `https://x/` dedup), and non-ASCII path/query characters are percent-encoded. `http` and
  `https` stay distinct; nothing else is rewritten. Only `http`/`https` without userinfo, ≤ 4096 chars.
- **Username enumeration.** `/api/user/new` returns 409 for taken names. The token endpoint runs a dummy
  PBKDF2 for unknown users so it does not add a timing leak.
- URLs cannot be edited or deleted. No metrics yet (Workers Analytics Engine is the likely choice).
