# Findings

What we assumed about the stack, what turned out to be true, and how we worked around it.

| Area | Assumed | Actual | Workaround |
|------|---------|--------|------------|
| Ollama / model | Qwen ~9B available locally | `qwen3.5:9b` requires a newer Ollama than the installed 0.20.2 | `chat-default` → `ollama_chat/gemma4:latest`. Upgrade Ollama, `ollama pull qwen3.5:9b`, change `OLLAMA_CHAT_MODEL` in `deploy-config/.env-llm` |
| LiteLLM tool calling | `ollama_chat/` passes OpenAI tools through | Works: gemma4 returned a `weather` tool call (~8s cold) | — |
| pi: disable built-ins | `tools: []` / extensions | `createAgentSession({ noTools: "builtin" })`; active tools = only `customTools` | — |
| pi: custom tools | `pi.registerTool` via extension factory | `createAgentSession({ customTools: [defineTool({...})] })` works directly; no extension needed. `typebox` (not `@sinclair/typebox`) for schemas | Use `customTools` |
| pi: provider | extension `registerProvider` | `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })` + `runtime.registerProvider("litellm", {...})` + `runtime.getModel(...)`, passed as `modelRuntime` + `model` | No extension needed |
| pi: system prompt | unknown | `new DefaultResourceLoader({ systemPrompt, noExtensions, noSkills, noContextFiles, ... })` then `reload()`. pi appends a `<cwd>` block after it | Use a throwaway temp `cwd`/`agentDir` per session so the user's `~/.pi` is never read |
| pi: events | names unknown | `message_update` (`assistantMessageEvent.type`: `text_start/text_delta/text_end/thinking_*/toolcall_*`), `message_start/end` (`message.role`), `tool_execution_start/update/end` (`toolCallId`, `toolName`, `args`, `result`, `isError`), `turn_*`, `agent_end`, `agent_settled` | — |
| pi: abort / busy | unknown | `session.abort()`, `session.isStreaming`; `prompt()` while streaming requires `streamingBehavior` | Runhandler rejects concurrent runs (THREAD_BUSY) |
| gemma4 via LiteLLM | `thinkingLevel: "off"` suppresses reasoning | gemma4 still streams `thinking_delta` events | Translator ignores thinking events |
| pi tool results → model | model sees `details` | Only `content` text reaches the model; `details` is UI/log-only. gemma4 tried to rebuild a weather_card from memory, failed pi's schema validation 3×, and repeated its answer each time | Tools that already produce a valid widget put it in `details.widget`; the translator emits a synthetic `show_widget` call for the UI. Model never copies widget JSON for weather |
| pi tool arg validation | our `validateWidget` reports errors | pi validates params against the TypeBox schema *before* `execute` and returns its own path-level error text to the model | Fine — errors are clear; our validator is a second line |
| CopilotKit version | v1 API (`useCopilotReadable`, `CopilotRuntime` from root) | 1.81 is the v2 API: `@copilotkit/react-core/v2` (`CopilotKit`, `CopilotChat`, `useAgentContext`, `useRenderTool`, `useDefaultRenderTool`), runtime `CopilotRuntime` + `createCopilotEndpoint` from `@copilotkit/runtime/v2` served via `hono/vercel` at `app/api/copilotkit/[[...slug]]` | — |
| CopilotKit + `@ag-ui/client` | any version | CopilotKit 1.81 pins `@ag-ui/client@1.0.2`; installing 1.0.3 breaks `HttpAgent` typing (private `_debug`) | Pin `@ag-ui/client@1.0.2` exactly |
| CopilotKit + Next 16 | SSR-safe provider | Provider calls `randomUUID()` during render; Next 16 cacheComponents prerender fails | Mount `<CopilotKit>` client-only (`useSyncExternalStore` gate) |
| Unique element ids | every element ours | CopilotKit's own chat DOM has no per-element ids; we can't set them | Our components carry unique ids; CopilotKit internals are exempt |
