# Open Agent web

The chat UI: Next.js with CopilotKit, talking to the agent over AG-UI.

```bash
npm ci
AGENT_URL=http://localhost:8000 npm run dev   # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
```

| Env var | Purpose |
| --- | --- |
| `AGENT_URL` | Agent base URL (default `http://localhost:8000`, `http://agent:8000` in compose) |
| `AGENT_SHARED_SECRET` | Sent as `x-agent-secret` on every call to the agent; must match the agent's value |

Everything under `app/api/` is a thin server-side proxy to the agent, so the browser never sees the agent URL or secret. Widget payloads are validated with the schemas in `../shared/widgets.ts` before rendering.

See the repository [README](../README.md) and [CONTRIBUTING](../CONTRIBUTING.md) for the full stack.
