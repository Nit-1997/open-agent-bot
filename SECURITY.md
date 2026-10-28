# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on the repository's Security tab, not in a public issue. Include steps to reproduce and the impact you see.

## Threat model

Open Agent is built to run on your own machine for one user.

- **No app login.** Anyone who can reach the web port can chat and change model keys. Compose binds every port to `127.0.0.1`; keep it that way unless you put an authenticating proxy in front.
- **`AGENT_SHARED_SECRET`.** Set the same value in `.env-agent` and `.env-nextjs` so only the web app can call the agent's chat and provider endpoints.
- **Model-controlled network access.** Pages the agent reads can contain prompt injection. The agent refuses private, loopback and link-local addresses before every request and after every redirect (`agent/src/tools/net.ts`), the browser refuses login, cart, checkout and booking steps (`agent/src/tools/browsePolicy.ts`), and PDF rendering blocks internal hosts.
- **Artifacts.** Model-written HTML is served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe, so it can't reach the app's origin.
- **Keys at rest.** Provider keys and OAuth tokens are stored in the `agent-data` volume with owner-only permissions and are never sent back to the browser.
