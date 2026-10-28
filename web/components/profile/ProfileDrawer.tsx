"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelList } from "@/lib/models";
import { initials, type Profile } from "@/lib/profile";
import { HomeField, InterestsField, ModelOptions, NameField } from "./fields";

export function ProfileDrawer(props: {
  profile: Profile;
  models: ModelList | null;
  onSave: (p: Profile) => void;
  onClose: () => void;
  onRestart: () => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<Profile>(props.profile);
  const [confirming, setConfirming] = useState(false);
  const { onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div id="profile-drawer" className="fixed inset-0 z-40 flex justify-end">
      <button id="profile-drawer-backdrop" type="button" aria-label="Close profile" onClick={onClose} className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      <aside id="profile-drawer-panel" role="dialog" aria-modal="true" aria-label="Profile" className="relative flex h-full w-full max-w-[420px] animate-rise flex-col border-l border-border bg-bg shadow-lift">
        <header id="profile-drawer-header" className="flex items-center justify-between px-6 pt-6">
          <div id="profile-drawer-who" className="flex items-center gap-3">
            <span id="profile-drawer-avatar" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-accent font-medium text-text-primary">
              {initials(draft.name) || "?"}
            </span>
            <div id="profile-drawer-heading">
              <h2 id="profile-drawer-title" className="font-display text-[26px] leading-none text-text-primary">
                {draft.name.trim() || "Your profile"}
              </h2>
              <p id="profile-drawer-sub" className="eyebrow mt-1.5">
                Saved in this browser only
              </p>
            </div>
          </div>
          <button id="profile-drawer-close" type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition hover:bg-surface hover:text-text-primary">
            <X id="profile-drawer-close-icon" aria-hidden="true" size={16} />
          </button>
        </header>
        <div id="profile-drawer-body" className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
          <NameField id="profile-name" value={draft} onChange={setDraft} />
          <HomeField id="profile-home" value={draft} onChange={setDraft} />
          <section id="profile-about" className="space-y-3">
            <h3 id="profile-about-title" className="eyebrow">
              About you
            </h3>
            <InterestsField id="profile-interests" value={draft} onChange={setDraft} />
          </section>
          <section id="profile-model" className="space-y-3">
            <h3 id="profile-model-title" className="eyebrow">
              Default model for new chats
            </h3>
            <ModelOptions id="profile-model-options" models={props.models} value={draft.defaultModel} onChange={(id) => setDraft({ ...draft, defaultModel: id })} />
          </section>
          <p id="profile-drawer-note" className="text-xs leading-relaxed text-text-muted">
            Profile changes apply to new chats. To change the model for this chat, use the menu in the header.
          </p>
          <div id="profile-drawer-danger" className="space-y-2 border-t border-border pt-5">
            <button id="profile-restart" type="button" onClick={props.onRestart} className="block text-sm text-text-secondary underline-offset-4 hover:underline">
              Run setup again
            </button>
            {confirming ? (
              <div id="profile-clear-confirm" className="flex items-center gap-2 text-sm">
                <span id="profile-clear-question" className="text-text-secondary">
                  Clear your name, home and notes?
                </span>
                <button id="profile-clear-yes" type="button" onClick={props.onClear} className="rounded-full bg-danger-bg px-3 py-1 text-xs font-medium text-danger-fg">
                  Yes, clear
                </button>
                <button id="profile-clear-no" type="button" onClick={() => setConfirming(false)} className="text-xs text-text-muted">
                  Cancel
                </button>
              </div>
            ) : (
              <button id="profile-clear" type="button" onClick={() => setConfirming(true)} className="block text-sm text-danger-fg underline-offset-4 hover:underline">
                Clear profile
              </button>
            )}
          </div>
        </div>
        <footer id="profile-drawer-footer" className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button id="profile-cancel" type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-border-strong">
            Cancel
          </button>
          <button
            id="profile-save"
            type="button"
            onClick={() => props.onSave({ ...draft, name: draft.name.trim(), home: draft.home.trim(), notes: draft.notes.trim() })}
            className="rounded-full bg-charcoal px-5 py-2 text-sm font-medium text-on-charcoal transition hover:opacity-85"
          >
            Save
          </button>
        </footer>
      </aside>
    </div>
  );
}
