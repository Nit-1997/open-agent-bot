"use client";

import { useState } from "react";
import type { ProviderView } from "../../../lib/providers.ts";
import { input, solid } from "./styles";

type LocalInput = { kind: string; baseUrl: string; apiKey?: string; label?: string };

type Submit<T> = (value: T) => Promise<boolean>;

export function KeyForm({ id, p, busy, onSubmit }: { id: string; p: ProviderView; busy: boolean; onSubmit: Submit<string> }) {
  const [key, setKey] = useState("");
  return (
    <form
      id={`${id}-key-form`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(key).then((saved) => saved && setKey(""));
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
  );
}

export function ConnectForm({ id, p, busy, onSubmit }: { id: string; p: ProviderView; busy: boolean; onSubmit: Submit<LocalInput> }) {
  const [url, setUrl] = useState(p.defaultBaseUrl ?? "");
  const [serverKey, setServerKey] = useState("");
  const [name, setName] = useState("");
  return (
    <form
      id={`${id}-connect-form`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          kind: p.id,
          baseUrl: url,
          ...(serverKey.trim() && { apiKey: serverKey }),
          ...(name.trim() && { label: name }),
        }).then((saved) => saved && setServerKey(""));
      }}
      className="mt-3 space-y-2"
    >
      <input
        id={`${id}-url`}
        aria-label={`${p.label} server URL`}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://host.docker.internal:8080/v1"
        className={input}
      />
      {p.id === "custom" && (
        <>
          <input
            id={`${id}-name`}
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. My vLLM box"
            className={input}
          />
          <input
            id={`${id}-server-key`}
            type="password"
            autoComplete="off"
            aria-label="Server API key (optional)"
            value={serverKey}
            onChange={(e) => setServerKey(e.target.value)}
            placeholder="API key, if the server needs one"
            className={input}
          />
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
  );
}
