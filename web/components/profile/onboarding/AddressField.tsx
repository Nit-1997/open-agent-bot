"use client";

import type { Place } from "@shared/onboarding";
import type { Home } from "@shared/profile";
import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { homeFromPlace } from "@/lib/onboarding";
import { searchPlaces } from "@/lib/onboardingApi";

export const TYPEAHEAD_MS = 250;

const input =
  "w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 text-[15px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300";

export function AddressField(props: {
  id: string;
  home: Home | undefined;
  detected: string | null;
  onChange: (home: Home | undefined) => void;
  search?: (q: string, signal?: AbortSignal) => Promise<Place[]>;
}) {
  const { id, home, onChange } = props;
  const search = props.search ?? searchPlaces;
  const [text, setText] = useState(home?.label ?? "");
  const [query, setQuery] = useState<string | null>(null);
  const [found, setFound] = useState<{ query: string; places: Place[] } | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!query || query.trim().length < 3) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      search(query, ac.signal)
        .then((places) => setFound({ query, places }))
        .catch(() => {});
    }, TYPEAHEAD_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, search]);

  const places = query && found?.query === query ? found.places : [];

  const pick = (p: Place) => {
    setText(p.label);
    setQuery(null);
    setFound(null);
    onChange(homeFromPlace(p));
  };

  return (
    <div id={id} className="relative space-y-1.5">
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="eyebrow block">
        Home address
        <span id={`${id}-hint`} className="ml-2 normal-case tracking-normal text-text-faint">
          type a few characters
        </span>
      </label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={places.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          setQuery(v);
          setActive(0);
          onChange(v.trim() ? { label: v.trim().slice(0, 200) } : undefined);
        }}
        onKeyDown={(e) => {
          if (!places.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, places.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(places[active]);
          } else if (e.key === "Escape") {
            setQuery(null);
          }
        }}
        placeholder="Street, city or ZIP"
        className={input}
      />
      {places.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-paper shadow-lift"
        >
          {places.map((p, n) => (
            <li
              id={`${id}-option-${n}`}
              key={`${p.label}-${n}`}
              role="option"
              aria-selected={n === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-text-secondary ${n === active ? "bg-surface" : ""}`}
            >
              <MapPin id={`${id}-option-${n}-icon`} aria-hidden="true" size={13} className="shrink-0 text-text-muted" />
              <span id={`${id}-option-${n}-label`} className="truncate">
                {p.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {props.detected ? (
        <p id={`${id}-detected`} className="text-xs text-success-fg">
          {`✓ ${props.detected}`}
        </p>
      ) : (
        home &&
        !home.city &&
        found?.query === query &&
        !places.length && (
          <p id={`${id}-freetext`} className="text-xs text-text-muted">
            No match picked. I&apos;ll keep what you typed.
          </p>
        )
      )}
    </div>
  );
}
