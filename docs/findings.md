# Findings

What we assumed about the stack, what turned out to be true, and how we worked around it.

| Area | Assumed | Actual | Workaround |
|------|---------|--------|------------|
| Ollama / model | Qwen ~9B available locally | `qwen3.5:9b` requires a newer Ollama than the installed 0.20.2 | `chat-default` → `ollama_chat/gemma4:latest`. Upgrade Ollama, `ollama pull qwen3.5:9b`, change `OLLAMA_CHAT_MODEL` in `deploy-config/.env-llm` |
| LiteLLM tool calling | `ollama_chat/` passes OpenAI tools through | Works: gemma4 returned a `weather` tool call (~8s cold) | — |
