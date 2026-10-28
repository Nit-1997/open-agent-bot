"use client";

import { useState } from "react";
import type { ModelList } from "@/lib/models";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import { HomeField, InterestsField, ModelOptions, NameField } from "./fields";

const STEPS = [
  { title: "Hi, I'm Open Agent.", sub: "I research, compare and plan for you. I never buy, book or sign in on your behalf." },
  { title: "Where should I look?", sub: "Your home sets the stores, currency and weather I check first." },
  { title: "A little about you", sub: "Pick anything that should shape what I suggest. Skip what you like." },
  { title: "Choose a default model", sub: "You can switch per chat from the header at any time." },
];

export function Onboarding({ models, onDone }: { models: ModelList | null; onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Profile>(EMPTY_PROFILE);
  const last = step === STEPS.length - 1;

  const finish = () =>
    onDone({
      ...draft,
      name: draft.name.trim(),
      home: draft.home.trim(),
      notes: draft.notes.trim(),
      ...((draft.defaultModel ?? models?.default) && { defaultModel: draft.defaultModel ?? models?.default }),
      onboarded: true,
    });

  return (
    <div id="onboarding" className="flex h-dvh w-full items-center justify-center px-4">
      <div id="onboarding-frame" className="glass w-full max-w-[580px] rounded-[28px] p-2">
        <div id="onboarding-card" key={step} className="w-full animate-rise rounded-[22px] border border-border bg-bg p-6 sm:p-8">
          <div id="onboarding-top" className="flex items-center justify-between">
            <span id="onboarding-orb" aria-hidden="true" className="orb h-9 w-9 animate-breathe" />
            <span id="onboarding-step" className="eyebrow">{`Step ${String(step + 1).padStart(2, "0")} / ${String(STEPS.length).padStart(2, "0")}`}</span>
          </div>
          <h1 id="onboarding-title" className="mt-8 font-display text-[40px] leading-[1.08] text-text-primary">
            {STEPS[step].title}
          </h1>
          <p id="onboarding-sub" className="mt-2 text-[15px] leading-relaxed text-text-secondary">
            {STEPS[step].sub}
          </p>
          <div id="onboarding-body" className="mt-8">
            {step === 0 && <NameField id="onboarding-name" value={draft} onChange={setDraft} autoFocus />}
            {step === 1 && <HomeField id="onboarding-home" value={draft} onChange={setDraft} autoFocus />}
            {step === 2 && <InterestsField id="onboarding-interests" value={draft} onChange={setDraft} />}
            {step === 3 && <ModelOptions id="onboarding-model" models={models} value={draft.defaultModel} onChange={(id) => setDraft({ ...draft, defaultModel: id })} />}
          </div>
          <div id="onboarding-progress" className="mt-10 flex gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span id={`onboarding-progress-${i}`} key={i} className={`h-1 flex-1 rounded-full transition ${i <= step ? "bg-charcoal" : "bg-surface-accent"}`} />
            ))}
          </div>
          <div id="onboarding-actions" className="mt-6 flex items-center justify-between">
            <button
              id="onboarding-skip"
              type="button"
              onClick={() => onDone({ ...EMPTY_PROFILE, onboarded: true })}
              className="text-sm text-text-muted transition hover:text-text-primary"
            >
              Skip setup
            </button>
            <div id="onboarding-nav" className="flex gap-2">
              {step > 0 && (
                <button
                  id="onboarding-back"
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-border-strong"
                >
                  Back
                </button>
              )}
              <button
                id="onboarding-next"
                type="button"
                onClick={() => (last ? finish() : setStep(step + 1))}
                className="rounded-full bg-charcoal px-5 py-2 text-sm font-medium text-on-charcoal transition hover:opacity-85"
              >
                {last ? "Start chatting" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
