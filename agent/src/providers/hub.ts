import type { AssistantMessage, Context, CredentialStore, Model } from "@earendil-works/pi-ai";
import { streamSimple as openAiCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { keyHint } from "../crypto/hint.js";
import type { CredentialListing, ProviderSettingsRepo } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { isBlockedError, type Lookup, publicHttpUrlError, resolvesInternal } from "../lib/net.js";
import { createSafeFetch } from "../lib/safeFetch.js";
import { type CatalogEntry, catalogEntry, CLOUD, LOCAL, LOCAL_KINDS, type LocalKind } from "./catalog.js";

type AnyModel = Model<any>;
type Complete = (model: AnyModel, context: Context, options?: { maxTokens?: number; signal?: AbortSignal }) => Promise<AssistantMessage>;

type Cost = { input: number; output: number; cacheRead: number; cacheWrite: number };
type SeedModel = { id: string; label: string; note?: string; contextWindow?: number; maxTokens?: number; cost?: Cost };
type Custom = { kind: LocalKind | "litellm"; label: string; baseUrl: string; models: SeedModel[] };
type Settings = { custom: Record<string, Custom>; enabled: Record<string, string[]>; hidden: string[] };

type ProviderView = {
  id: string;
  label: string;
  kind: CatalogEntry["kind"];
  site: string;
  keyUrl?: string;
  defaultBaseUrl?: string;
  methods: Array<"api_key" | "oauth">;
  oauthLabel?: string;
  note?: string;
  configured: boolean;
  source?: "key" | "signin" | "server";
  hint?: string;
  baseUrl?: string;
  enabled: string[];
  modelCount: number;
};

export type SecretName = "brave-search";

type EnabledModel = { id: string; label: string; provider: string; note?: string };
type ModelView = { id: string; label: string; contextWindow: number; note?: string; enabled: boolean };
type TestResult = { ok: boolean; toolCall: boolean; latencyMs: number; cost?: number; error?: string };

const LOCAL_MODEL = {
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
};
const MAX_OUTPUT_TOKENS = 32_000;

type LiteLlmModelInfo = {
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_token?: number | null;
  output_cost_per_token?: number | null;
  cache_read_input_token_cost?: number | null;
  cache_creation_input_token_cost?: number | null;
};
type LiteLlmInfo = { data?: Array<{ model_name?: string; model_info?: LiteLlmModelInfo | null }> };

const perMillion = (n: number | null | undefined) => Number(((n ?? 0) * 1e6).toFixed(6));

function gatewayCost(i: LiteLlmModelInfo): Cost | undefined {
  if (!i.input_cost_per_token && !i.output_cost_per_token) return undefined;
  return {
    input: perMillion(i.input_cost_per_token),
    output: perMillion(i.output_cost_per_token),
    cacheRead: perMillion(i.cache_read_input_token_cost),
    cacheWrite: perMillion(i.cache_creation_input_token_cost),
  };
}

async function withGatewayLimits(f: typeof fetch, gateway: { baseUrl: string; apiKey: string; models: SeedModel[] }): Promise<SeedModel[]> {
  try {
    const res = await f(`${gateway.baseUrl.replace(/\/+$/, "")}/model/info`, {
      headers: { authorization: `Bearer ${gateway.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return gateway.models;
    const data = ((await res.json()) as LiteLlmInfo).data ?? [];
    const info = new Map(data.map((d) => [d.model_name, d.model_info]));
    const seeds = gateway.models.length
      ? gateway.models
      : [...new Set(data.map((d) => d.model_name).filter((n): n is string => !!n))].map((id) => ({ id, label: id }));
    return seeds.map((m) => {
      const i = info.get(m.id);
      return {
        ...m,
        ...(i?.max_input_tokens && { contextWindow: i.max_input_tokens }),
        ...(i?.max_output_tokens && { maxTokens: Math.min(i.max_output_tokens, MAX_OUTPUT_TOKENS) }),
        ...(i && gatewayCost(i) && { cost: gatewayCost(i) }),
      };
    });
  } catch {
    return gateway.models;
  }
}

function priceNote(m: AnyModel): string | undefined {
  const { input, output } = m.cost ?? { input: 0, output: 0 };
  if (!input && !output) return undefined;
  const n = (x: number) => `$${Number(x.toFixed(2))}`;
  return `${n(input)} in · ${n(output)} out per 1M tokens`;
}

export type HubOptions = {
  userId: string;
  isAdmin: boolean;
  settings: ProviderSettingsRepo;
  credentials: HubCredentials;
  litellm?: { baseUrl: string; apiKey: string; models: SeedModel[] };
  fetch?: typeof fetch;
  userFetch?: typeof fetch;
  complete?: Complete;
  lookup?: Lookup;
};

export type HubCredentials = CredentialStore & { listings(): Promise<CredentialListing[]> };

const PRIVATE_TARGET = "That address isn't reachable from the server.";

function parseSettings(raw: unknown): Settings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return {
    custom: v.custom && typeof v.custom === "object" ? { ...v.custom } : {},
    enabled: v.enabled && typeof v.enabled === "object" ? { ...v.enabled } : {},
    hidden: Array.isArray(v.hidden) ? [...v.hidden] : [],
  };
}

export class ProviderHub {
  private constructor(
    private readonly rt: ModelRuntime,
    private readonly opts: HubOptions,
    private settings: Settings,
    private keys: Record<string, string>,
    private readonly hints: Map<string, string>,
    private readonly devId: string,
    private readonly userFetch: typeof fetch,
    private readonly completeFn: Complete,
    private readonly signedIn: Map<string, "key" | "signin">,
    private stamp: string,
  ) {}

  static async create(opts: HubOptions): Promise<ProviderHub> {
    const rt = await ModelRuntime.create({
      credentials: opts.credentials,
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const stored = await opts.settings.get();
    const settings = parseSettings(stored.data);
    const listings = await opts.credentials.listings();
    const hints = new Map(listings.map((l) => [l.provider, l.hint]));
    const signedIn = new Map<string, "key" | "signin">();
    for (const l of listings)
      if (catalogEntry(l.provider)?.kind === "cloud") signedIn.set(l.provider, l.kind === "oauth" ? "signin" : "key");
    const keys: Record<string, string> = {};
    for (const l of listings) {
      if (catalogEntry(l.provider)?.kind === "cloud" || l.kind !== "api_key") continue;
      const c = await opts.credentials.read(l.provider);
      if (c?.type === "api_key" && c.key) keys[l.provider] = c.key;
    }
    delete settings.custom.litellm;
    const hub = new ProviderHub(
      rt,
      opts,
      settings,
      keys,
      hints,
      stored.deviceId,
      opts.isAdmin ? (opts.fetch ?? fetch) : (opts.userFetch ?? createSafeFetch()),
      opts.complete ?? ((m, c, o) => rt.completeSimple(m, c, o)),
      signedIn,
      stored.stamp,
    );
    if (opts.isAdmin && opts.litellm && !settings.hidden.includes("litellm")) {
      const models = await withGatewayLimits(opts.fetch ?? fetch, opts.litellm);
      settings.custom.litellm = { kind: "litellm", label: "LiteLLM gateway", baseUrl: opts.litellm.baseUrl, models };
      keys.litellm = opts.litellm.apiKey;
      settings.enabled.litellm ??= models.map((m) => m.id);
    }
    for (const id of Object.keys(settings.custom)) {
      if (id !== "litellm" && !(await hub.targetAllowed(settings.custom[id].baseUrl))) {
        log.warn(`[providers] user=${opts.userId} skipped ${id}: private address`);
        delete settings.custom[id];
        continue;
      }
      hub.registerCustom(id);
    }
    return hub;
  }

  private async targetAllowed(baseUrl: string): Promise<boolean> {
    if (this.opts.isAdmin) return true;
    if (publicHttpUrlError(baseUrl)) return false;
    return !(await resolvesInternal(new URL(baseUrl).hostname, this.opts.lookup));
  }

  get runtime(): ModelRuntime {
    return this.rt;
  }

  private registerCustom(id: string): void {
    const c = this.settings.custom[id];
    const userFetch = this.userFetch;
    this.rt.registerProvider(id, {
      name: c.label,
      baseUrl: c.baseUrl,
      apiKey: this.keys[id] || "none",
      api: "openai-completions",
      ...(!this.opts.isAdmin && {
        streamSimple: (model, context, options) =>
          openAiCompletions(model as Model<"openai-completions">, context, { ...options, fetch: userFetch }),
      }),
      models: c.models.map((m) => ({
        id: m.id,
        name: m.label,
        ...LOCAL_MODEL,
        ...(m.contextWindow && { contextWindow: m.contextWindow }),
        ...(m.maxTokens && { maxTokens: m.maxTokens }),
        ...(m.cost && { cost: m.cost }),
      })),
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
        ...(e.note && { note: e.note }),
        configured,
        ...(configured && { source: e.kind === "local" ? "server" : this.signedIn.get(e.id) }),
        ...(configured && this.hints.get(e.id) && { hint: this.hints.get(e.id) }),
        ...(custom && { baseUrl: custom.baseUrl }),
        enabled: configured ? this.enabledFor(e.id) : [],
        modelCount: this.rt.getModels(e.id).length,
      } satisfies ProviderView;
    });
  }

  private cloud(id: string): CatalogEntry {
    const e = catalogEntry(id);
    if (e?.kind !== "cloud") throw new UserError(`provider ${id} is not supported`, "not_found");
    return e;
  }

  async setKey(id: string, key: string): Promise<void> {
    this.cloud(id);
    const value = key.trim();
    if (!value) throw new UserError("the key is empty");
    await this.rt.login(id, "api_key", { prompt: async () => value, notify: () => {} });
    this.signedIn.set(id, "key");
    this.hints.set(id, keyHint(value));
  }

  async login(id: string, interaction: Parameters<ModelRuntime["login"]>[2]): Promise<void> {
    if (!this.cloud(id).oauthLabel) throw new UserError(`${id} has no sign-in option here`);
    const deviceId = this.deviceId();
    await this.rt.login(id, "oauth", interaction, { agentName: "Open Agent", getDeviceId: () => deviceId }).catch((err: unknown) => {
      throw signInError(id, err);
    });
    this.signedIn.set(id, "signin");
    const hint = (await this.opts.credentials.listings()).find((l) => l.provider === id)?.hint;
    if (hint) this.hints.set(id, hint);
  }

  async remove(id: string): Promise<void> {
    const entry = catalogEntry(id);
    if (!entry) throw new UserError(`provider ${id} is not supported`, "not_found");
    if (entry.kind === "cloud") {
      await this.rt.logout(id);
      this.signedIn.delete(id);
      this.hints.delete(id);
      return;
    }
    if (!(id in this.settings.custom)) return;
    this.rt.unregisterProvider(id);
    delete this.settings.custom[id];
    delete this.settings.enabled[id];
    if (id === "litellm" && !this.settings.hidden.includes("litellm")) this.settings.hidden.push("litellm");
    if (id !== "litellm") await this.dropKey(id);
    delete this.keys[id];
    await this.save();
  }

  async addLocal(input: { kind: string; baseUrl: string; apiKey?: string; label?: string }): Promise<ProviderView> {
    if (!(LOCAL_KINDS as readonly string[]).includes(input.kind)) throw new UserError(`unknown local server type ${input.kind}`);
    const kind = input.kind as LocalKind;
    let base: URL;
    try {
      base = new URL(input.baseUrl.trim().replace(/\/+$/, ""));
    } catch {
      throw new UserError("the base URL isn't a valid URL");
    }
    if (!/^https?:$/.test(base.protocol)) throw new UserError("the base URL must start with http:// or https://");
    const baseUrl = base.href.replace(/\/+$/, "");
    if (!(await this.targetAllowed(baseUrl))) throw new UserError(PRIVATE_TARGET, "unprocessable");
    let ids: string[];
    try {
      const res = await this.userFetch(`${baseUrl}/models`, {
        headers: input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ids = (((await res.json()) as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id).filter((m): m is string => !!m);
    } catch (err) {
      if (isBlockedError(err)) throw new UserError(PRIVATE_TARGET, "unprocessable");
      throw new UserError(`couldn't list models at ${baseUrl}/models (${err instanceof Error ? err.message : String(err)})`, "upstream");
    }
    if (!ids.length) throw new UserError(`the server at ${baseUrl} has no models`, "upstream");
    const label = input.label?.trim() || catalogEntry(kind)!.label;
    this.settings.custom[kind] = { kind, label, baseUrl, models: ids.map((m) => ({ id: m, label: m })) };
    this.settings.enabled[kind] = ids;
    const apiKey = input.apiKey?.trim();
    if (apiKey) await this.storeKey(kind, apiKey);
    else await this.dropKey(kind);
    this.registerCustom(kind);
    await this.save();
    return this.list().find((p) => p.id === kind)!;
  }

  models(id: string): ModelView[] {
    if (!catalogEntry(id)) throw new UserError(`provider ${id} is not supported`, "not_found");
    const enabled = new Set(this.enabledFor(id));
    return this.rt.getModels(id).map((m) => ({
      id: m.id,
      label: m.name || m.id,
      contextWindow: m.contextWindow,
      ...(priceNote(m) && { note: priceNote(m) }),
      enabled: enabled.has(m.id),
    }));
  }

  async setEnabled(id: string, modelIds: string[]): Promise<void> {
    if (!catalogEntry(id)) throw new UserError(`provider ${id} is not supported`, "not_found");
    const unknown = modelIds.find((m) => !this.rt.getModel(id, m));
    if (unknown) throw new UserError(`unknown model ${unknown} for ${id}`);
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

  secret(name: SecretName): string | undefined {
    return this.keys[`secret:${name}`] || undefined;
  }

  async setSecret(name: SecretName, value: string): Promise<void> {
    const v = value.trim();
    if (!v) throw new UserError("the key is empty");
    await this.storeKey(`secret:${name}`, v);
  }

  async removeSecret(name: SecretName): Promise<void> {
    await this.dropKey(`secret:${name}`);
  }

  secretHint(name: SecretName): string | undefined {
    return this.hints.get(`secret:${name}`);
  }

  deviceId(): string {
    return this.devId;
  }

  private async storeKey(id: string, key: string): Promise<void> {
    await this.opts.credentials.modify(id, async () => ({ type: "api_key", key }));
    this.keys[id] = key;
    this.hints.set(id, keyHint(key));
  }

  private async dropKey(id: string): Promise<void> {
    await this.opts.credentials.delete(id);
    delete this.keys[id];
    this.hints.delete(id);
  }

  private async save(): Promise<void> {
    const { litellm: _gateway, ...custom } = this.settings.custom;
    this.stamp = await this.opts.settings.put({ ...this.settings, custom }, this.stamp);
  }
}

function signInError(providerId: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (providerId === "openai" && message.includes("invalid_grant")) {
    return new Error(
      "OpenAI accepted the sign-in but refused to issue a token (invalid_grant). Sign in with ChatGPT needs a paid ChatGPT plan such as Plus or Pro. Use an OpenAI API key instead, or sign in with a paid account.",
    );
  }
  return err instanceof Error ? err : new Error(message);
}
