"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Favicon } from "@/components/chat/Favicon";
import { contextLabel, type ProviderModel, type ProviderView, providersApi, type TestResult } from "@/lib/providers";

const input =
  "w-full rounded-xl border border-border bg-paper px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300";
const ghost = "rounded-full border border-border px-3 py-1 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary disabled:opacity-40";
const solid = "rounded-full bg-charcoal px-3.5 py-1.5 text-[12px] font-medium text-on-charcoal transition hover:opacity-85 disabled:opacity-40";
const SEARCH_AFTER = 12;

type Mode = null | "key" | "connect" | "models" | "confirm";

function status(p: ProviderView): string {
  if (!p.configured) return "Not connected";
  if (p.kind === "local") return `Connected · ${p.baseUrl ?? ""}`;
  return p.source === "signin" ? "Connected · signed in" : "Connected · API key";
}

function testText(r: TestResult): string {
  if (!r.ok) return `Didn't pass: ${r.error ?? "no tool call"}`;
  return `Tool calls work · ${(r.latencyMs / 1000).toFixed(1)}s${r.cost ? ` · $${r.cost.toFixed(4)}` : ""}`;
}

function ModelPicker({ p, onSaved }: { p: ProviderView; onSaved: () => void }) {
  const id = `provider-${p.id}-models`;
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    providersApi
      .models(p.id)
      .then(setModels)
      .catch((e: Error) => setError(e.message));
  }, [p.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (models ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [models, query]);

  const toggle = async (modelId: string) => {
    if (!models) return;
    const next = models.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m));
    setModels(next);
    try {
      await providersApi.setEnabled(p.id, next.filter((m) => m.enabled).map((m) => m.id));
      onSaved();
    } catch (e) {
      setModels(models);
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger-fg">
        {error}
      </p>
    );
  }
  if (!models) {
    return (
      <p id={`${id}-loading`} className="mt-2 text-xs text-text-muted">
        Loading models…
      </p>
    );
  }
  return (
    <div id={id} className="mt-3 space-y-2">
      {models.length > SEARCH_AFTER && (
        <input id={`${id}-search`} aria-label={`Search ${p.label} models`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${models.length} models`} className={input} />
      )}
      <ul id={`${id}-list`} className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {shown.map((m, i) => (
          <li id={`${id}-${i}`} key={m.id}>
            <label id={`${id}-${i}-label`} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-surface">
              <input id={`${id}-${i}-check`} type="checkbox" checked={m.enabled} onChange={() => void toggle(m.id)} className="mt-1 accent-charcoal" />
              <span id={`${id}-${i}-text`} className="min-w-0">
                <span id={`${id}-${i}-name`} className="block text-sm text-text-primary">
                  {m.label}
                </span>
                <span id={`${id}-${i}-meta`} className="flex flex-wrap gap-x-2 text-[11px] text-text-muted">
                  {m.note && <span id={`${id}-${i}-price`}>{m.note}</span>}
                  <span id={`${id}-${i}-context`}>{contextLabel(m.contextWindow)}</span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderRow({ p, refresh, onChanged }: { p: ProviderView; refresh: () => Promise<void>; onChanged: () => void }) {
  const id = `provider-${p.id}`;
  const [mode, setMode] = useState<Mode>(null);
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(p.defaultBaseUrl ?? "");
  const [serverKey, setServerKey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      onChanged();
      setMode(null);
      setKey("");
      setServerKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    setError(null);
    try {
      setTest(await providersApi.test(`${p.id}/${p.enabled[0]}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li id={id} aria-label={p.label} className="rounded-2xl border border-border bg-paper p-3">
      <div id={`${id}-head`} className="flex items-center gap-3">
        <Favicon id={`${id}-icon`} host={p.site} size={28} className="ring-0" />
        <div id={`${id}-titles`} className="min-w-0 flex-1">
          <p id={`${id}-label`} className="text-sm font-medium text-text-primary">
            {p.label}
          </p>
          <p id={`${id}-status`} className={`truncate text-[11px] ${p.configured ? "text-success-fg" : "text-text-muted"}`}>
            {status(p)}
          </p>
        </div>
        <div id={`${id}-actions`} className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {!p.configured && p.kind === "cloud" && (
            <button id={`${id}-add-key`} type="button" onClick={() => setMode(mode === "key" ? null : "key")} className={ghost}>
              Add key
            </button>
          )}
          {!p.configured && p.kind === "local" && (
            <button id={`${id}-connect`} type="button" onClick={() => setMode(mode === "connect" ? null : "connect")} className={ghost}>
              Connect
            </button>
          )}
          {p.configured && (
            <>
              <button id={`${id}-models-toggle`} type="button" aria-expanded={mode === "models"} onClick={() => setMode(mode === "models" ? null : "models")} className={`${ghost} inline-flex items-center gap-1`}>
                {`Models · ${p.enabled.length} on`}
                <ChevronDown id={`${id}-models-chevron`} aria-hidden="true" size={12} className={mode === "models" ? "rotate-180" : ""} />
              </button>
              <button id={`${id}-test`} type="button" disabled={busy || !p.enabled.length} onClick={() => void runTest()} className={ghost}>
                Test
              </button>
              <button id={`${id}-remove`} type="button" onClick={() => setMode("confirm")} className={ghost}>
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {!p.configured && p.keyUrl && (
        <a id={`${id}-key-link`} href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 ml-10 inline-block text-[11px] text-mist-600 underline underline-offset-2">
          Get a key ↗
        </a>
      )}

      {mode === "key" && (
        <form
          id={`${id}-key-form`}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => providersApi.saveKey(p.id, key));
          }}
          className="mt-3 flex gap-2"
        >
          <input
            id={`${id}-key-input`}
            type="password"
            autoComplete="off"
            aria-label={`${p.label} API key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your API key"
            className={input}
          />
          <button id={`${id}-key-save`} type="submit" disabled={busy} className={solid}>
            Save key
          </button>
        </form>
      )}

      {mode === "connect" && (
        <form
          id={`${id}-connect-form`}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              providersApi.addLocal({
                kind: p.id,
                baseUrl: url,
                ...(serverKey.trim() && { apiKey: serverKey }),
                ...(name.trim() && { label: name }),
              }),
            );
          }}
          className="mt-3 space-y-2"
        >
          <input id={`${id}-url`} aria-label={`${p.label} server URL`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://host.docker.internal:8080/v1" className={input} />
          {p.id === "custom" && (
            <>
              <input id={`${id}-name`} aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. My vLLM box" className={input} />
              <input id={`${id}-server-key`} type="password" autoComplete="off" aria-label="Server API key (optional)" value={serverKey} onChange={(e) => setServerKey(e.target.value)} placeholder="API key, if the server needs one" className={input} />
            </>
          )}
          <div id={`${id}-connect-actions`} className="flex items-center justify-between gap-2">
            <p id={`${id}-connect-hint`} className="text-[11px] text-text-muted">
              Use host.docker.internal for servers running on this computer.
            </p>
            <button id={`${id}-connect-save`} type="submit" disabled={busy || !url.trim()} className={solid}>
              Connect server
            </button>
          </div>
        </form>
      )}

      {mode === "confirm" && (
        <div id={`${id}-confirm`} className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span id={`${id}-confirm-text`} className="text-text-secondary">{`Remove ${p.label}?`}</span>
          <button id={`${id}-confirm-yes`} type="button" disabled={busy} onClick={() => void run(() => providersApi.remove(p.id))} className="rounded-full bg-danger-bg px-3 py-1 text-xs font-medium text-danger-fg">
            Yes, remove
          </button>
          <button id={`${id}-confirm-no`} type="button" onClick={() => setMode(null)} className="text-xs text-text-muted">
            Cancel
          </button>
        </div>
      )}

      {mode === "models" && p.configured && <ModelPicker p={p} onSaved={() => void refresh().then(onChanged)} />}

      {test && (
        <p id={`${id}-test-result`} className={`mt-2 inline-flex items-center gap-1.5 text-xs ${test.ok ? "text-success-fg" : "text-danger-fg"}`}>
          {test.ok && <Check id={`${id}-test-icon`} aria-hidden="true" size={12} />}
          {testText(test)}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger-fg">
          {error}
        </p>
      )}
    </li>
  );
}

export function ModelsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setProviders(await providersApi.list());
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setLoadError(e.message));
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const section = (kind: ProviderView["kind"], title: string) => (
    <section id={`models-${kind}`} className="space-y-2">
      <h3 id={`models-${kind}-title`} className="eyebrow">
        {title}
      </h3>
      <ul id={`models-${kind}-list`} className="space-y-2">
        {(providers ?? [])
          .filter((p) => p.kind === kind)
          .map((p) => (
            <ProviderRow key={p.id} p={p} refresh={refresh} onChanged={onChanged} />
          ))}
      </ul>
    </section>
  );

  return (
    <div id="models-panel" className="fixed inset-0 z-50 flex justify-end">
      <button id="models-panel-backdrop" type="button" aria-label="Close models" onClick={onClose} className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      <aside id="models-panel-sheet" role="dialog" aria-modal="true" aria-label="Models" className="relative flex h-full w-full max-w-[480px] animate-rise flex-col border-l border-border bg-bg shadow-lift">
        <header id="models-panel-header" className="flex items-start justify-between gap-3 px-6 pt-6">
          <div id="models-panel-titles">
            <h2 id="models-panel-title" className="font-display text-[28px] leading-none text-text-primary">
              Models
            </h2>
            <p id="models-panel-sub" className="mt-2 text-xs text-text-muted">
              Connect providers and pick which models appear in your menu. Keys stay on this machine and are never shown again.
            </p>
          </div>
          <button id="models-panel-close" type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-surface hover:text-text-primary">
            <X id="models-panel-close-icon" aria-hidden="true" size={16} />
          </button>
        </header>
        <div id="models-panel-body" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {loadError && (
            <p id="models-panel-error" role="alert" className="text-sm text-danger-fg">
              {loadError}
            </p>
          )}
          {!providers && !loadError && (
            <p id="models-panel-loading" className="text-sm text-text-muted">
              Loading providers…
            </p>
          )}
          {providers && (
            <>
              {section("cloud", "Cloud providers")}
              {section("local", "Local and self-hosted")}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
