# Model providers managed from the UI

## Why

Users should add providers and keys in the app, the way other chat apps let them, and pick from those models per chat. OpenRecruiting does this through LiteLLM: it keeps a registry, generates the LiteLLM config, writes keys to an env file, and recreates the gateway through a locked-down sidecar. pi already ships most of what that needs: about 40 provider catalogues with prices, a credential store with live add and remove, and OAuth login flows designed to be driven by an app. So this design is pi-centric (option B, chosen by the user).

## Shape

- **One shared `ModelRuntime`** in the agent, created once. It replaces the per-session runtime. Its credential store is `auth.json` on the agent's data volume (mode 600). Non-secret settings live beside it in `providers.json`: custom local servers and each provider's enabled models.
- **Curated provider list** shown in the UI:
  - Cloud: OpenAI (API key, or Sign in with ChatGPT), Anthropic (API key only), OpenRouter, Together, Groq, Google.
  - Local: Ollama, llama.cpp, LM Studio, or any OpenAI-compatible URL, which also covers a LiteLLM gateway.
- **Claude Pro/Max sign-in is never offered.** Anthropic's terms only allow it in Claude Code and Claude.ai.
- **The current LiteLLM setup** is seeded as a custom provider named `litellm`, from `LLM_BASE_URL` and `AGENT_MODELS`, so existing chats and defaults keep working.
- **Model references** are `provider/model`, for example `openai/gpt-4.1`, `ollama/qwen3.5:35b` or `litellm/chat-sonnet-5.5`. The per-chat model and the profile default both use them.
- **Agent API** (behind the shared secret, proxied by Next):
  - `GET /providers`: catalogue entries with configured status, auth methods and enabled models.
  - `POST /providers/:id/key`: save an API key.
  - `DELETE /providers/:id`: remove the provider's credential, or remove a custom server.
  - `POST /providers/local`: add a local or custom server; its models are discovered from `GET {baseUrl}/models`.
  - `GET /providers/:id/models`: the provider's catalogue.
  - `PUT /providers/:id/models`: set which of its models are enabled.
  - `POST /providers/:id/test`: a tiny tool-call round trip that reports pass or fail, latency and cost.
  - `GET /models`: enabled models across configured providers, for the header menu.
  - Sign-in flow:
    - `POST /providers/:id/login` returns a flow id.
    - `GET /logins/:flow` reports the flow's events: an auth URL to open, a prompt, progress, done or error.
    - `POST /logins/:flow/answer` sends the user's answer, such as a pasted redirect URL.
- **Secrets never leave the agent.** No endpoint returns a key; status reports only "configured" and its source.

## Sign in with ChatGPT

pi's `openai-chatgpt` flow redirects to `http://127.0.0.1:1455/auth/callback`. The agent container publishes `127.0.0.1:1455` and listens there (`PI_OAUTH_CALLBACK_HOST=0.0.0.0`), so the browser's redirect lands in the agent. If it doesn't, the UI shows pi's own fallback: paste the final redirect URL. OpenRouter's OAuth uses a random port, which can't be published, so OpenRouter is key-only.

## Known limits

- **There is no app login yet.** Anyone who can reach the web port can change keys. That's acceptable while ports are bound to localhost; a settings password must come before any remote deploy.
- **Catalogues are pi's built-in snapshot.** Model refresh from the network stays off for now.
