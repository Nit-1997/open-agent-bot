import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type CatalogEntry, catalogEntry, CLOUD, LOCAL, LOCAL_KINDS, type LocalKind } from "./catalog.js";

type AnyModel = Model<any>;
type Complete = (model: AnyModel, context: Context, options?: { maxTokens?: number; signal?: AbortSignal }) => Promise<AssistantMessage>;

export type SeedModel = { id: string; label: string; note?: string };
type Custom = { kind: LocalKind | "litellm"; label: string; baseUrl: string; models: SeedModel[] };
type Settings = { custom: Record<string, Custom>; enabled: Record<string, string[]>; hidden: string[] };

export type ProviderView = {
  id: string;
  label: string;
  kind: CatalogEntry["kind"];
  site: string;
  keyUrl?: string;
  defaultBaseUrl?: string;
  methods: Array<"api_key" | "oauth">;
  oauthLabel?: string;
  configured: boolean;
  source?: "key" | "signin" | "server";
  baseUrl?: string;
  enabled: string[];
  modelCount: number;
};

export type EnabledModel = { id: string; label: string; provider: string; note?: string };
export type ModelView = { id: string; label: string; contextWindow: number; note?: string; enabled: boolean };
export type TestResult = { ok: boolean; toolCall: boolean; latencyMs: number; cost?: number; error?: string };

const LOCAL_MODEL = { reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 };

function priceNote(m: AnyModel): string | undefined {
  const { input, output } = m.cost ?? { input: 0, output: 0 };
  if (!input && !output) return undefined;
  const n = (x: number) => `$${Number(x.toFixed(2))}`;
  return `${n(input)} in · ${n(output)} out per 1M tokens`;
}

export class ProviderHub {
  private constructor(
    private readonly rt: ModelRuntime,
    private readonly dir: string,
    private settings: Settings,
    private keys: Record<string, string>,
    private readonly f: typeof fetch,
    private readonly completeFn: Complete,
    private readonly signedIn: Map<string, "key" | "signin">,
  ) {}

  static async create(opts: {
    dataDir: string;
    litellm?: { baseUrl: string; apiKey: string; models: SeedModel[] };
    fetch?: typeof fetch;
    complete?: Complete;
  }): Promise<ProviderHub> {
    await mkdir(opts.dataDir, { recursive: true, mode: 0o700 });
    await chmod(opts.dataDir, 0o700);
    const rt = await ModelRuntime.create({
      authPath: join(opts.dataDir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const settings: Settings = { custom: {}, enabled: {}, hidden: [], ...(await readJson(join(opts.dataDir, "providers.json"))) };
    const keys = (await readJson<Record<string, string>>(join(opts.dataDir, "local-keys.json"))) ?? {};
    const signedIn = new Map<string, "key" | "signin">();
    for (const e of CLOUD) {
      const check = await rt.checkAuth(e.id).catch(() => undefined);
      if (check) signedIn.set(e.id, (check as { type?: string }).type === "oauth" ? "signin" : "key");
    }
    const hub = new ProviderHub(rt, opts.dataDir, settings, keys, opts.fetch ?? fetch, opts.complete ?? ((m, c, o) => rt.completeSimple(m, c, o)), signedIn);
    if (opts.litellm && !settings.hidden.includes("litellm")) {
      settings.custom.litellm = { kind: "litellm", label: "LiteLLM gateway", baseUrl: opts.litellm.baseUrl, models: opts.litellm.models };
      keys.litellm = opts.litellm.apiKey;
      settings.enabled.litellm ??= opts.litellm.models.map((m) => m.id);
    }
    for (const id of Object.keys(settings.custom)) hub.registerCustom(id);
    return hub;
  }

  get runtime(): ModelRuntime {
    return this.rt;
  }

  private registerCustom(id: string): void {
    const c = this.settings.custom[id];
    this.rt.registerProvider(id, {
      name: c.label,
      baseUrl: c.baseUrl,
      apiKey: this.keys[id] || "none",
      api: "openai-completions",
      models: c.models.map((m) => ({ id: m.id, name: m.label, ...LOCAL_MODEL })),
    });
  }

  private isConfigured(id: string): boolean {
    const entry = catalogEntry(id);
    if (!entry) return false;
    return entry.kind === "local" ? id in this.settings.custom : this.signedIn.has(id);
  }

  private enabledFor(id: string): string[] {
    const entry = catalogEntry(id);
    const stored = this.settings.enabled[id];
    if (stored) return stored;
    return (entry?.recommended ?? []).filter((m) => this.rt.getModel(id, m));
  }

  list(): ProviderView[] {
    const visible = [...CLOUD, ...LOCAL.filter((e) => e.id !== "litellm" || "litellm" in this.settings.custom)];
    return visible.map((e) => {
      const configured = this.isConfigured(e.id);
      const custom = this.settings.custom[e.id];
      return {
        id: e.id,
        label: custom?.label ?? e.label,
        kind: e.kind,
        site: e.site,
        ...(e.keyUrl && { keyUrl: e.keyUrl }),
        ...(e.defaultBaseUrl && { defaultBaseUrl: e.defaultBaseUrl }),
        methods: e.kind === "local" ? [] : e.oauthLabel ? ["api_key", "oauth"] : ["api_key"],
        ...(e.oauthLabel && { oauthLabel: e.oauthLabel }),
        configured,
        ...(configured && { source: e.kind === "local" ? "server" : this.signedIn.get(e.id) }),
        ...(custom && { baseUrl: custom.baseUrl }),
        enabled: configured ? this.enabledFor(e.id) : [],
        modelCount: this.rt.getModels(e.id).length,
      } satisfies ProviderView;
    });
  }

  private cloud(id: string): CatalogEntry {
    const e = catalogEntry(id);
    if (!e || e.kind !== "cloud") throw new Error(`provider ${id} is not supported`);
    return e;
  }

  async setKey(id: string, key: string): Promise<void> {
    this.cloud(id);
    const value = key.trim();
    if (!value) throw new Error("the key is empty");
    await this.rt.login(id, "api_key", { prompt: async () => value, notify: () => {} });
    this.signedIn.set(id, "key");
    await this.lockAuthFile();
  }

  async login(id: string, interaction: Parameters<ModelRuntime["login"]>[2]): Promise<void> {
    if (!this.cloud(id).oauthLabel) throw new Error(`${id} has no sign-in option here`);
    await this.rt.login(id, "oauth", interaction, { agentName: "Open Agent" });
    this.signedIn.set(id, "signin");
    await this.lockAuthFile();
  }

  async remove(id: string): Promise<void> {
    const entry = catalogEntry(id);
    if (!entry) throw new Error(`provider ${id} is not supported`);
    if (entry.kind === "cloud") {
      await this.rt.logout(id);
      this.signedIn.delete(id);
      await this.lockAuthFile();
      return;
    }
    if (!(id in this.settings.custom)) return;
    this.rt.unregisterProvider(id);
    delete this.settings.custom[id];
    delete this.settings.enabled[id];
    delete this.keys[id];
    if (id === "litellm") this.settings.hidden.push("litellm");
    await this.save();
  }

  async addLocal(input: { kind: string; baseUrl: string; apiKey?: string; label?: string }): Promise<ProviderView> {
    if (!(LOCAL_KINDS as readonly string[]).includes(input.kind)) throw new Error(`unknown local server type ${input.kind}`);
    const kind = input.kind as LocalKind;
    let base: URL;
    try {
      base = new URL(input.baseUrl.trim().replace(/\/+$/, ""));
    } catch {
      throw new Error("the base URL isn't a valid URL");
    }
    if (!/^https?:$/.test(base.protocol)) throw new Error("the base URL must start with http:// or https://");
    const baseUrl = base.href.replace(/\/+$/, "");
    let ids: string[];
    try {
      const res = await this.f(`${baseUrl}/models`, {
        headers: input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ids = (((await res.json()) as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id).filter((m): m is string => !!m);
    } catch (err) {
      throw new Error(`couldn't list models at ${baseUrl}/models (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!ids.length) throw new Error(`the server at ${baseUrl} has no models`);
    const label = input.label?.trim() || catalogEntry(kind)!.label;
    this.settings.custom[kind] = { kind, label, baseUrl, models: ids.map((m) => ({ id: m, label: m })) };
    this.settings.enabled[kind] = ids;
    if (input.apiKey?.trim()) this.keys[kind] = input.apiKey.trim();
    else delete this.keys[kind];
    this.registerCustom(kind);
    await this.save();
    return this.list().find((p) => p.id === kind)!;
  }

  models(id: string): ModelView[] {
    if (!catalogEntry(id)) throw new Error(`provider ${id} is not supported`);
    const enabled = new Set(this.enabledFor(id));
    return this.rt
      .getModels(id)
      .map((m) => ({ id: m.id, label: m.name || m.id, contextWindow: m.contextWindow, ...(priceNote(m) && { note: priceNote(m) }), enabled: enabled.has(m.id) }));
  }

  async setEnabled(id: string, modelIds: string[]): Promise<void> {
    if (!catalogEntry(id)) throw new Error(`provider ${id} is not supported`);
    const unknown = modelIds.find((m) => !this.rt.getModel(id, m));
    if (unknown) throw new Error(`unknown model ${unknown} for ${id}`);
    this.settings.enabled[id] = [...new Set(modelIds)];
    await this.save();
  }

  enabledModels(): EnabledModel[] {
    return this.list()
      .filter((p) => p.configured)
      .flatMap((p) => {
        const notes = new Map((this.settings.custom[p.id]?.models ?? []).map((m) => [m.id, m.note]));
        return p.enabled.flatMap((mid) => {
          const m = this.rt.getModel(p.id, mid);
          if (!m) return [];
          const note = notes.get(mid) ?? priceNote(m);
          return [{ id: `${p.id}/${mid}`, label: m.name || mid, provider: p.label, ...(note && { note }) }];
        });
      });
  }

  resolve(ref: string): AnyModel | undefined {
    const slash = ref.indexOf("/");
    const [provider, modelId] = slash < 0 ? ["litellm", ref] : [ref.slice(0, slash), ref.slice(slash + 1)];
    if (!this.isConfigured(provider)) return undefined;
    return this.rt.getModel(provider, modelId);
  }

  async test(ref: string): Promise<TestResult> {
    const model = this.resolve(ref);
    if (!model) return { ok: false, toolCall: false, latencyMs: 0, error: `model ${ref} is not available` };
    const started = Date.now();
    try {
      const reply = await this.completeFn(
        model,
        {
          systemPrompt: "You are a test. Always answer by calling the provided tool.",
          messages: [{ role: "user", content: "What time is it in Paris? Use the tool.", timestamp: Date.now() }],
          tools: [{ name: "get_time", description: "Current time in a city", parameters: Type.Object({ city: Type.String() }) }],
        } as Context,
        { maxTokens: 200, signal: AbortSignal.timeout(30000) },
      );
      const toolCall = (reply.content ?? []).some((c) => c.type === "toolCall");
      const error = (reply as { errorMessage?: string }).errorMessage;
      return {
        ok: toolCall && !error,
        toolCall,
        latencyMs: Date.now() - started,
        ...(reply.usage?.cost?.total != null && { cost: reply.usage.cost.total }),
        ...(error ? { error } : !toolCall ? { error: "the model answered in text instead of calling the tool" } : {}),
      };
    } catch (err) {
      return { ok: false, toolCall: false, latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async lockAuthFile(): Promise<void> {
    await chmod(join(this.dir, "auth.json"), 0o600).catch(() => {});
  }

  private async save(): Promise<void> {
    await writeFile(join(this.dir, "providers.json"), JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    const secrets = Object.fromEntries(Object.entries(this.keys).filter(([id]) => id !== "litellm"));
    await writeFile(join(this.dir, "local-keys.json"), JSON.stringify(secrets), { mode: 0o600 });
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
