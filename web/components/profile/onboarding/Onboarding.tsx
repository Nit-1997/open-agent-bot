"use client";

import { emptyProfile, type Profile, type Section } from "@shared/profile";
import { useCallback, useEffect, useState } from "react";
import { type ModelList, normalizeRef } from "@/lib/models";
import { jevProvider, type SlideId, slideOrder, starters, summaryLines } from "@/lib/onboarding";
import { useOnboardingOptions } from "@/lib/onboardingApi";
import { type ProviderView, providersApi } from "@/lib/providers";
import { JevSlide } from "./JevSlide";
import { ModelStep } from "./ModelStep";
import { ShoppingSection, TravelSection, YouSection } from "./sections";
import { Summary } from "./Summary";

type Copy = { eyebrow: string; title: string; why: string; skip?: string };

const COPY: Record<Exclude<SlideId, "model">, Copy> = {
  you: {
    eyebrow: "You",
    title: "Let's start with you",
    why: "Home sets your currency, weather and nearby stores. Household and food shape every plan and cart.",
    skip: "Skip this section",
  },
  travel: {
    eyebrow: "Travel",
    title: "How do you like to travel?",
    why: "So trips start from your airports, airlines and kind of stay, and you never have to repeat them.",
    skip: "Skip travel",
  },
  shopping: {
    eyebrow: "Shopping",
    title: "Where do you shop?",
    why: "So carts are priced at your stores, in your budget, and through the apps you already use.",
    skip: "Skip shopping",
  },
  jev: {
    eyebrow: "Make it sharper · optional",
    title: "Turn on Jev for better picks",
    why: "Jev checks which products, hotels and sources really match what you asked. With it, the right grocery item came first 86% of the time instead of 62%.",
    skip: "Skip, use without Jev",
  },
  summary: { eyebrow: "All set", title: "Here's what I know about you", why: "Tap any line to change it." },
};

const modelCopy = (hasModels: boolean): Copy => ({
  eyebrow: "Model",
  title: hasModels ? "Choose your model" : "Add a model to start",
  why: hasModels
    ? "This is the default for new chats. You can switch per chat from the header."
    : "Connect a cloud provider with a key, or a model server. Keys are encrypted and never shown again.",
});

function clearSection(p: Profile, s: Section): Profile {
  const empty = emptyProfile();
  if (s === "you") return { ...p, name: undefined, home: undefined, household: empty.household, food: [] };
  if (s === "travel") return { ...p, travel: empty.travel };
  if (s === "shopping") return { ...p, shopping: empty.shopping };
  return p;
}

const SECTION_OF: Partial<Record<SlideId, Section>> = { you: "you", travel: "travel", shopping: "shopping", jev: "jev" };

export function Onboarding(props: {
  profile: Profile;
  models: ModelList | null;
  onModelsChanged: () => void;
  onDone: (profile: Profile, starter: string | null) => Promise<void>;
}) {
  const { models, onModelsChanged } = props;
  const [draft, setDraft] = useState<Profile>(props.profile);
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [modelFirst, setModelFirst] = useState<boolean | null>(null);
  const [jevHere, setJevHere] = useState(false);
  const [slide, setSlide] = useState<SlideId | null>(null);
  const [adding, setAdding] = useState(false);
  const [starter, setStarter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useOnboardingOptions(draft.home);

  const refreshProviders = useCallback(() => {
    providersApi
      .list()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const ready = models !== null && providers !== null;
  const jev = jevProvider(providers);
  const hasModels = !!models?.models.length;
  const first = modelFirst ?? !hasModels;
  const slides = slideOrder({ modelFirst: first, showJev: !jev || jevHere });
  const current: SlideId = slide && slides.includes(slide) ? slide : slides[0];
  const index = slides.indexOf(current);

  if (ready && modelFirst === null) setModelFirst(!hasModels);

  const chosen = normalizeRef(draft.defaultModel) ?? models?.default ?? undefined;
  const modelOk = !!chosen && !!models?.models.some((m) => m.id === chosen);
  const modelLabel = models?.models.find((m) => m.id === chosen)?.label;

  const providersChanged = () => {
    onModelsChanged();
    refreshProviders();
  };

  const go = (to: SlideId) => {
    setError(null);
    setSlide(to);
  };
  const next = () => go(slides[Math.min(index + 1, slides.length - 1)]);
  const keep = () => {
    const section = SECTION_OF[current];
    if (section) setDraft((d) => ({ ...d, skipped: d.skipped.filter((s) => s !== section) }));
    next();
  };
  const skip = () => {
    const section = SECTION_OF[current];
    if (section) setDraft((d) => ({ ...clearSection(d, section), skipped: [...new Set([...d.skipped, section])] }));
    next();
  };

  const finish = async () => {
    if (!modelOk) return go("model");
    setSaving(true);
    setError(null);
    try {
      await props.onDone({ ...draft, defaultModel: chosen, onboardedAt: new Date().toISOString() }, starter);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const copy = current === "model" ? modelCopy(hasModels && !adding) : COPY[current];
  const summary = summaryLines(draft, { jev: slides.includes("jev") || jev ? jev : undefined, modelLabel });
  const ideas = starters(draft, options?.airports ?? []);
  const last = current === "summary";
  const blocked = current === "model" && !modelOk;

  return (
    <div id="onboarding" className="flex min-h-dvh w-full items-center justify-center px-4 py-4">
      <div id="onboarding-frame" className="glass w-full max-w-[640px] rounded-[28px] p-2">
        <div
          id="onboarding-card"
          key={current}
          className="w-full animate-rise rounded-[22px] border border-border bg-bg p-5 sm:px-7 sm:py-6"
        >
          <div id="onboarding-top" className="flex items-center justify-between">
            <span id="onboarding-orb" aria-hidden="true" className="orb h-9 w-9 animate-breathe" />
            <span id="onboarding-step" className="eyebrow">
              {ready
                ? `${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")} · ${copy.eyebrow}`
                : "Getting ready"}
            </span>
          </div>
          {!ready ? (
            <p id="onboarding-loading" className="mt-8 text-sm text-text-muted">
              Checking which models are set up…
            </p>
          ) : (
            <>
              <h1 id="onboarding-title" className="mt-4 font-display text-[30px] leading-[1.08] text-text-primary sm:text-[34px]">
                {copy.title}
              </h1>
              <p id="onboarding-sub" className="mt-2 text-[14px] leading-relaxed text-text-secondary">
                {copy.why}
              </p>
              <div id="onboarding-body" className="mt-3">
                {current === "you" && <YouSection id="onboarding-you" profile={draft} onChange={setDraft} options={options} />}
                {current === "travel" && <TravelSection id="onboarding-travel" profile={draft} onChange={setDraft} options={options} />}
                {current === "shopping" && (
                  <ShoppingSection id="onboarding-shopping" profile={draft} onChange={setDraft} options={options} />
                )}
                {current === "jev" && (
                  <JevSlide
                    id="onboarding-jev"
                    onSaved={() => {
                      setJevHere(true);
                      providersChanged();
                    }}
                  />
                )}
                {current === "model" && (
                  <ModelStep
                    id="onboarding-model"
                    models={models}
                    value={chosen}
                    onChange={(id) => setDraft((d) => ({ ...d, defaultModel: id }))}
                    onProvidersChanged={providersChanged}
                    adding={adding}
                    onAdding={setAdding}
                  />
                )}
                {current === "summary" && (
                  <Summary id="onboarding-summary" lines={summary} starters={ideas} starter={starter} onEdit={go} onStarter={setStarter} />
                )}
              </div>
              {error && (
                <p id="onboarding-error" role="alert" className="mt-4 text-sm text-danger-fg">
                  {error}
                </p>
              )}
              {last && !modelOk && (
                <p id="onboarding-needs-model" className="mt-4 text-sm text-warn-fg">
                  Pick a model before you start.
                </p>
              )}
              <div id="onboarding-progress" className="mt-4 flex gap-1.5">
                {slides.map((s, i) => (
                  <button
                    id={`onboarding-progress-${s}`}
                    key={s}
                    type="button"
                    aria-label={`Go to ${s}`}
                    aria-current={s === current ? "step" : undefined}
                    onClick={() => go(s)}
                    className={`h-1 flex-1 rounded-full transition ${i <= index ? "bg-charcoal" : "bg-surface-accent"}`}
                  />
                ))}
              </div>
              <div id="onboarding-actions" className="mt-4 flex items-center justify-between gap-3">
                {copy.skip ? (
                  <button
                    id="onboarding-skip"
                    type="button"
                    onClick={skip}
                    className="text-sm text-text-muted transition hover:text-text-primary"
                  >
                    {copy.skip}
                  </button>
                ) : (
                  <span id="onboarding-skip-spacer" />
                )}
                <div id="onboarding-nav" className="flex gap-2">
                  {index > 0 && (
                    <button
                      id="onboarding-back"
                      type="button"
                      onClick={() => go(slides[index - 1])}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-border-strong"
                    >
                      Back
                    </button>
                  )}
                  <button
                    id="onboarding-next"
                    type="button"
                    disabled={blocked || saving || (last && !modelOk)}
                    onClick={() => (last ? void finish() : keep())}
                    className="rounded-full bg-charcoal px-5 py-2 text-sm font-medium text-on-charcoal transition hover:opacity-85 disabled:opacity-40"
                  >
                    {last ? (saving ? "Saving…" : "Start chatting") : "Next"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
