# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on the repository's Security tab, not in a public issue. Include steps to reproduce and the impact you see.

## Threat model

Open Agent runs for a small invited group: the web app on Vercel, the agent behind Caddy on one server, and every user's data in one Supabase project. The full design is `docs/superpowers/specs/2026-10-31-supabase-auth-design.md`.

- **Invite-only accounts.** Supabase sign-ups are off (`disable_signup`), and a `before-user-created` Postgres hook only lets in emails an admin approved (`public.invited_emails`). The admin API's `createUser` does not run that hook, so only the owner's admin scripts call it.
- **Sessions.** The web app holds the Supabase session in `HttpOnly; Secure; SameSite=Lax` host-only cookies through `@supabase/ssr` server clients. The browser has no Supabase client and no readable token.
- **Web to agent.** Server to server only, with the user's access token and the service secret (`AGENT_SERVICE_SECRET`). The agent verifies the token against the project's ES256 JWKS and takes the user id only from it, checks the account is active on every request, and re-checks the admin role live for admin routes. Browser headers are never forwarded.
- **Data isolation.** Postgres RLS is on with no policies or grants for `anon` or `authenticated`, so the publishable key reads nothing. Only the agent's secret key touches data, through repositories that put the verified user id into every query and Storage path. Integration tests (`npm run test:supabase -w @oab/core`) prove the denial for every table, function and the artifacts bucket.
- **Keys at rest.** Provider keys and OAuth tokens are sealed with AES-256-GCM under a per-row data key wrapped by a master key from `CREDENTIAL_KEYS`, bound to the user, provider and kind. The browser only ever sees a hint like `sk-ant-…a91f`. Logs mask keys and tokens.
- **Model-controlled network access.** Pages the agent reads can contain prompt injection. `fetch_page` refuses private, loopback and link-local addresses, including public names that resolve to them, on every request and redirect (`packages/core/src/lib/net.ts`). The agent's Chromium applies the same check to every request a page makes, scripts and images included (`packages/core/src/browser/guard.ts`), and refuses login, cart, checkout and booking steps (`packages/core/src/browser/policy.ts`). Custom model servers must be public addresses for everyone but the admin. The DNS check runs just before each request, so a hostname whose DNS answer changes in the gap between the check and the request is still a residual risk.
- **Artifacts.** Model-written HTML lives in a private Storage bucket, is served only through the agent and web with `Content-Security-Policy: sandbox allow-scripts` and `nosniff`, and is shown in a sandboxed iframe, so it can't reach the app's origin.
- **Chat stream proxy.** The browser reaches the CopilotKit runtime only through `/api/copilotkit/*`, which `@oab/bff` forwards to the agent's `/copilotkit` for an allowlist of four endpoints (`GET info`, `POST agent/openagent/run`, `agent/openagent/connect`, `agent/openagent/stop/<thread>`), drops the query, copies only `content-type` back and sets `private, no-store`; everything else answers 404 or 405. Unsafe methods need a same-origin `Origin`. In the agent, a stop, connect or run on another user's thread answers 403 `forbidden`; runs are scoped per user, so isolation never depends on the owner map. Each user may hold at most `COPILOT_CONNECTS_PER_USER` connect streams (429 over the cap), each bounded by `COPILOT_CONNECT_MAX_MS`. Bodies are capped before they are read: 4 MiB for a run, 1 MiB for everything else, chunked bodies included. CopilotKit telemetry is forced off: the agent refuses to start unless `COPILOTKIT_TELEMETRY_DISABLED=true`.
- **Agent host.** The agent container runs read-only with tmpfs scratch space, no capabilities and no volumes; nothing user-owned is written to its disk.

## Known limitations

- **Stale admin capabilities.** The admin-only capabilities (private-network model servers and the operator's model gateway) follow the `role` claim in the user's access token, not the live admin check that guards admin routes. After an admin is demoted they keep both until the token expires (up to 1 hour), and a chat session opened while they were an admin keeps its model connections until it goes idle (up to 30 more minutes). Admin routes themselves are refused immediately. This is accepted while every account is invited; deriving these capabilities from the live check, or dropping the user's sessions on demotion, is scheduled before sign-ups open.

