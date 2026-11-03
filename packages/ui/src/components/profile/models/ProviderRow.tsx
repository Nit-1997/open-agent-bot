"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";
import { Favicon } from "../../chat/Favicon.tsx";
import { type ProviderView, providersApi, type TestResult } from "../../../lib/providers.ts";
import { ModelPicker } from "./ModelPicker";
import { ConnectForm, KeyForm } from "./ProviderForms";
import { SignIn } from "./SignIn";
import { ghost, solid } from "./styles";

type Mode = null | "key" | "connect" | "models" | "confirm" | "signin";

function status(p: ProviderView): string {
  if (!p.configured) return "Not connected";
  if (p.kind === "local") return `Connected · ${p.baseUrl ?? ""}`;
  if (p.hint) return `Connected · ${p.hint}`;
  return p.source === "signin" ? "Connected · signed in" : "Connected · API key";
}

function testText(r: TestResult): string {
  if (!r.ok) return `Didn't pass: ${r.error ?? "no tool call"}`;
  return `Tool calls work · ${(r.latencyMs / 1000).toFixed(1)}s${r.cost ? ` · $${r.cost.toFixed(4)}` : ""}`;
}

export function ProviderRow({
  p,
  refresh,
  onChanged,
  pollMs,
}: {
  p: ProviderView;
  refresh: () => Promise<void>;
  onChanged: () => void;
  pollMs: number;
}) {
  const id = `provider-${p.id}`;
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      onChanged();
      setMode(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const signedIn = useCallback(() => {
    void refresh().then(() => {
      onChanged();
      setMode(null);
    });
  }, [refresh, onChanged]);

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
          {p.note && (
            <p id={`${id}-note`} className="truncate text-[11px] text-text-muted">
              {p.note}
            </p>
          )}
        </div>
        <div id={`${id}-actions`} className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {!p.configured && p.methods.includes("oauth") && p.oauthLabel && (
            <button id={`${id}-signin`} type="button" onClick={() => setMode(mode === "signin" ? null : "signin")} className={solid}>
              {p.oauthLabel}
            </button>
          )}
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
              {p.modelCount > 0 && (
                <>
                  <button
                    id={`${id}-models-toggle`}
                    type="button"
                    aria-expanded={mode === "models"}
                    onClick={() => setMode(mode === "models" ? null : "models")}
                    className={`${ghost} inline-flex items-center gap-1`}
                  >
                    {`Models · ${p.enabled.length} on`}
                    <ChevronDown
                      id={`${id}-models-chevron`}
                      aria-hidden="true"
                      size={12}
                      className={mode === "models" ? "rotate-180" : ""}
                    />
                  </button>
                  <button
                    id={`${id}-test`}
                    type="button"
                    disabled={busy || !p.enabled.length}
                    onClick={() => void runTest()}
                    className={ghost}
                  >
                    Test
                  </button>
                </>
              )}
              <button id={`${id}-remove`} type="button" onClick={() => setMode("confirm")} className={ghost}>
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {!p.configured && p.keyUrl && (
        <a
          id={`${id}-key-link`}
          href={p.keyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 ml-10 inline-block text-[11px] text-mist-600 underline underline-offset-2"
        >
          Get a key ↗
        </a>
      )}

      {mode === "key" && <KeyForm id={id} p={p} busy={busy} onSubmit={(key) => run(() => providersApi.saveKey(p.id, key))} />}

      {mode === "connect" && <ConnectForm id={id} p={p} busy={busy} onSubmit={(local) => run(() => providersApi.addLocal(local))} />}

      {mode === "confirm" && (
        <div id={`${id}-confirm`} className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span id={`${id}-confirm-text`} className="text-text-secondary">{`Remove ${p.label}?`}</span>
          <button
            id={`${id}-confirm-yes`}
            type="button"
            disabled={busy}
            onClick={() => void run(() => providersApi.remove(p.id))}
            className="rounded-full bg-danger-bg px-3 py-1 text-xs font-medium text-danger-fg"
          >
            Yes, remove
          </button>
          <button id={`${id}-confirm-no`} type="button" onClick={() => setMode(null)} className="text-xs text-text-muted">
            Cancel
          </button>
        </div>
      )}

      {mode === "models" && p.configured && <ModelPicker p={p} onSaved={() => void refresh().then(onChanged)} />}

      {mode === "signin" && !p.configured && <SignIn p={p} pollMs={pollMs} onDone={signedIn} onCancel={() => setMode(null)} />}

      {test && (
        <p
          id={`${id}-test-result`}
          className={`mt-2 inline-flex items-center gap-1.5 text-xs ${test.ok ? "text-success-fg" : "text-danger-fg"}`}
        >
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
