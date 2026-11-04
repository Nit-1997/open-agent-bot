# Open Agent web

The chat UI: Next.js with CopilotKit, talking to the agent over AG-UI.

Install and run from the repository root (one npm workspace, one `package-lock.json`):

```bash
npm ci
npm run dev -w @oab/cloud-web   # needs the env vars below; sign-in cookies are Secure, so use https://app.localhost through Caddy or http://localhost
npm run lint -w @oab/cloud-web && npm run format:check -w @oab/cloud-web && npm run typecheck -w @oab/cloud-web && npm test -w @oab/cloud-web && npm run build -w @oab/cloud-web
```

Every variable is required and checked on first use; nothing falls back to a default. For the hosted stack they live in `cloud/deploy-config/env-files/frontend/.env` (names in the `.env.example` beside it).

| Env var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Inlined at build time, so Docker passes it as a build arg |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`), used only by the server for sign-in. Build arg too |
| `APP_ORIGIN` | This app's origin, e.g. `https://app.localhost`. Redirects are built from it and non-GET requests must come from it |
| `AGENT_URL` | Agent base URL (`http://agent:8000` in compose, `https://<AGENT_HOST>` on Vercel) |
| `AGENT_SERVICE_SECRET` | 64 hex chars, sent as `x-agent-secret`; must match the agent's value |

Sign-in uses `@supabase/ssr` server clients only; the browser never holds a Supabase client or a readable token. `proxy.ts` refreshes the session on every request, sends signed-out visitors to `/login` (or `401` on `/api/*`), hides `/admin` from non-admins and sets a per-request nonce CSP. Everything under `app/api/` is a thin server-side proxy that forwards the user's access token and the service secret to the agent, never the browser's headers or cookies. Widget payloads are validated with the schemas in `@oab/shared/widgets` (`../../packages/shared/src/widgets.ts`) before rendering.

See the repository [README](../../README.md) and [CONTRIBUTING](../../CONTRIBUTING.md) for the full stack.
