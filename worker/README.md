# Sign-in helper (Cloudflare Worker)

Keeps the Google refresh token server-side (AES-GCM encrypted in KV) so the PWA can stay signed in.
Endpoints: `POST /exchange`, `POST /refresh`, `POST /revoke`.

## Deploy

Run from `resto-app/worker/`. Needs a free Cloudflare account and a Google OAuth *Web* client
(authorised JavaScript origins = your app origin; no redirect URI needed for the popup flow).

```sh
npm install
npx wrangler login

# 1. KV namespace — copy the printed id into wrangler.toml ([[kv_namespaces]] id)
npx wrangler kv namespace create TOKENS

# 2. Edit wrangler.toml: set ALLOWED_ORIGINS to your Pages origin (replace REPLACE-ME.pages.dev)

# 3. Secrets (each command prompts for the value)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
openssl rand -base64 32        # generate a key, then paste it when prompted:
npx wrangler secret put ENC_KEY

# 4. Deploy
npx wrangler deploy
```

Wrangler prints the worker URL (`https://resto-auth.<you>.workers.dev`). Put it in the web app as
`VITE_AUTH_URL` (see `resto-app/web/.env.example`).

Keep `ENC_KEY` safe: if it changes, every stored session becomes unreadable and users must sign in again.

## Develop / test

```sh
npm test          # vitest, plain Node, mocked fetch + in-memory KV
npm run typecheck
```
