# Sign-in helper (Cloudflare Worker)

Keeps the Google refresh token server-side (AES-GCM encrypted in KV) so the PWA can stay signed in.
Endpoints: `POST /exchange`, `POST /refresh`, `POST /revoke` (sign out this phone: deletes only its
session), `POST /disconnect` (revokes the Google grant for the account: signs out all its phones).

Storage: one refresh token per Google account (`a:<sha256(sub)>`) shared by that account's phones,
and one entry per phone session (`s:<sha256(session)>` → the account). Both are AES-GCM encrypted.

## Deploy

Run from the `worker/` folder. Needs a free Cloudflare account and a Google OAuth *Web* client
(authorised JavaScript origins = your app origin; no redirect URI needed for the popup flow).

```sh
npm install
npx wrangler login

# 1. KV namespace — copy the printed id into wrangler.toml ([[kv_namespaces]] id)
npx wrangler kv namespace create TOKENS

# 2. Edit wrangler.toml: set ALLOWED_ORIGINS to your Pages origin (replace REPLACE-ME.pages.dev).
#    Before production, REMOVE http://localhost:5173 from ALLOWED_ORIGINS — it is for local dev only.

# 3. Secrets (each command prompts for the value)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
openssl rand -base64 32        # generate a key, then paste it when prompted:
npx wrangler secret put ENC_KEY

# 4. Deploy
npx wrangler deploy
```

Wrangler prints the worker URL (`https://resto-auth.<you>.workers.dev`). Put it in the web app as
`VITE_AUTH_URL` (see `web/.env.example`).

`ENC_KEY` must be base64 of exactly 32 bytes (the `openssl` command above); any other length makes
every request fail with `500 server_error`.

Behaviour notes:
- Stored sessions and account tokens expire after 180 days without use; each successful `/refresh`
  renews both.
- Google sends a refresh token only on first consent. A second phone of the same account reuses the
  stored one. If none is stored, `/exchange` revokes the grant and answers `409 consent_required`;
  the app asks the user to tap "Continue with Google" and Google asks for consent again.
- Unexpected failures answer `500 {"error":"server_error"}` (with CORS headers, no details).

Keep `ENC_KEY` safe: if it changes, every stored session becomes unreadable and users must sign in again.

## Develop / test

```sh
npm test          # vitest, plain Node, mocked fetch + in-memory KV
npm run typecheck
```
