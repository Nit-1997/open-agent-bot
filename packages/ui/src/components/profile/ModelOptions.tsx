import { type ModelList, normalizeRef } from "@/lib/models";

export function ModelOptions({
  id,
  models,
  value,
  onChange,
}: {
  id: string;
  models: ModelList | null;
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  if (!models) {
    return (
      <p id={`${id}-unavailable`} className="text-sm text-text-muted">
        Couldn&apos;t load the model list. You can pick one later from the header.
      </p>
    );
  }
  const selected = normalizeRef(value) ?? models.default;
  if (!models.models.length) {
    return (
      <p id={`${id}-empty`} className="text-sm text-text-muted">
        No models yet. Add a provider first.
      </p>
    );
  }
  return (
    <div id={id} role="radiogroup" aria-label="Default model" className="space-y-2">
      {models.models.map((m, n) => {
        const on = m.id === selected;
        return (
          <label
            id={`${id}-option-${n}`}
            key={m.id}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition ${on ? "border-charcoal bg-paper shadow-float" : "border-border bg-paper hover:border-border-strong"}`}
          >
            <input
              id={`${id}-option-${n}-input`}
              type="radio"
              name={id}
              checked={on}
              onChange={() => onChange(m.id)}
              className="mt-1 accent-mist-500"
            />
            <span id={`${id}-option-${n}-text`} className="min-w-0">
              <span id={`${id}-option-${n}-label`} className="block text-[15px] font-medium text-text-primary">
                {m.label}
              </span>
              {(m.provider || m.note) && (
                <span id={`${id}-option-${n}-note`} className="mt-0.5 block text-[13px] text-text-muted">
                  {[m.provider, m.note].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
