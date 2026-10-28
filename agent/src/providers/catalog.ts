export type ProviderKind = "cloud" | "local";

export type CatalogEntry = {
  id: string;
  label: string;
  kind: ProviderKind;
  site: string;
  keyUrl?: string;
  oauthLabel?: string;
  defaultBaseUrl?: string;
  recommended?: string[];
};

export const CLOUD: CatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    site: "openai.com",
    keyUrl: "https://platform.openai.com/api-keys",
    oauthLabel: "Sign in with ChatGPT",
    recommended: ["gpt-5.5", "gpt-5.4-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "cloud",
    site: "anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    recommended: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "cloud",
    site: "openrouter.ai",
    keyUrl: "https://openrouter.ai/keys",
    recommended: ["anthropic/claude-sonnet-5.5", "deepseek/deepseek-v4-flash"],
  },
  {
    id: "together",
    label: "Together AI",
    kind: "cloud",
    site: "together.ai",
    keyUrl: "https://api.together.ai/settings/api-keys",
    recommended: ["deepseek-ai/DeepSeek-V4.1-Flash", "Qwen/Qwen3.6-Plus"],
  },
  { id: "groq", label: "Groq", kind: "cloud", site: "groq.com", keyUrl: "https://console.groq.com/keys", recommended: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] },
  {
    id: "google",
    label: "Google Gemini",
    kind: "cloud",
    site: "ai.google.dev",
    keyUrl: "https://aistudio.google.com/apikey",
    recommended: ["gemini-3.5-flash", "gemini-pro-latest"],
  },
];

export const LOCAL: CatalogEntry[] = [
  { id: "ollama", label: "Ollama", kind: "local", site: "ollama.com", defaultBaseUrl: "http://host.docker.internal:11434/v1" },
  { id: "llamacpp", label: "llama.cpp", kind: "local", site: "github.com", defaultBaseUrl: "http://host.docker.internal:8080/v1" },
  { id: "lmstudio", label: "LM Studio", kind: "local", site: "lmstudio.ai", defaultBaseUrl: "http://host.docker.internal:1234/v1" },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "local", site: "openai.com" },
  { id: "litellm", label: "LiteLLM gateway", kind: "local", site: "litellm.ai" },
];

export const LOCAL_KINDS = ["ollama", "llamacpp", "lmstudio", "custom"] as const;
export type LocalKind = (typeof LOCAL_KINDS)[number];

export const catalogEntry = (id: string) => [...CLOUD, ...LOCAL].find((e) => e.id === id);
