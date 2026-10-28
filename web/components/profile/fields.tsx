import { Check } from "lucide-react";
import { type ModelList, normalizeRef } from "@/lib/models";
import { INTERESTS, type Profile } from "@/lib/profile";

const input =
  "w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 text-[15px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300";

type FieldProps = { id: string; value: Profile; onChange: (p: Profile) => void };

export function NameField({ id, value, onChange, autoFocus }: FieldProps & { autoFocus?: boolean }) {
  return (
    <div id={id} className="space-y-2">
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="block text-sm font-medium text-text-secondary">
        What should I call you?
      </label>
      <input id={`${id}-input`} autoFocus={autoFocus} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Your first name" className={input} />
    </div>
  );
}

export function HomeField({ id, value, onChange, autoFocus }: FieldProps & { autoFocus?: boolean }) {
  return (
    <div id={id} className="space-y-2">
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="block text-sm font-medium text-text-secondary">
        Where&apos;s home?
      </label>
      <input id={`${id}-input`} autoFocus={autoFocus} value={value.home} onChange={(e) => onChange({ ...value, home: e.target.value })} placeholder="City, or city and ZIP" className={input} />
      <p id={`${id}-hint`} className="text-xs text-text-muted">
        Used for weather, nearby stores and local search, so I don&apos;t have to ask.
      </p>
    </div>
  );
}

export function InterestsField({ id, value, onChange }: FieldProps) {
  const toggle = (i: string) =>
    onChange({ ...value, interests: value.interests.includes(i) ? value.interests.filter((x) => x !== i) : [...value.interests, i] });
  return (
    <div id={id} className="space-y-4">
      <div id={`${id}-chips`} className="flex flex-wrap gap-2">
        {INTERESTS.map((i, n) => {
          const on = value.interests.includes(i);
          return (
            <button
              id={`${id}-chip-${n}`}
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(i)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition ${
                on ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-paper text-text-secondary hover:border-border-strong"
              }`}
            >
              {on && <Check id={`${id}-chip-${n}-check`} aria-hidden="true" size={12} />}
              {i}
            </button>
          );
        })}
      </div>
      <div id={`${id}-notes`} className="space-y-2">
        <label id={`${id}-notes-label`} htmlFor={`${id}-notes-input`} className="block text-sm font-medium text-text-secondary">
          Anything else I should keep in mind?
        </label>
        <textarea
          id={`${id}-notes-input`}
          rows={3}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="Allergies, favourite stores, who you usually plan for…"
          className={`${input} resize-none`}
        />
      </div>
    </div>
  );
}

export function ModelOptions({ id, models, value, onChange }: { id: string; models: ModelList | null; value: string | undefined; onChange: (id: string) => void }) {
  if (!models) {
    return (
      <p id={`${id}-unavailable`} className="text-sm text-text-muted">
        Couldn&apos;t load the model list. You can pick one later from the header.
      </p>
    );
  }
  const selected = normalizeRef(value) ?? models.default;
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
            <input id={`${id}-option-${n}-input`} type="radio" name={id} checked={on} onChange={() => onChange(m.id)} className="mt-1 accent-mist-500" />
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
