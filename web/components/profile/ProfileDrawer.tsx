"use client";

import { SignOutForm } from "@/components/auth/SignOutForm";
import type { Profile } from "@shared/profile";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { ModelList } from "@/lib/models";
import { useOnboardingOptions } from "@/lib/onboardingApi";
import { initials } from "@/lib/profile";
import { ModelOptions } from "./ModelOptions";
import { ShoppingSection, TravelSection, YouSection } from "./onboarding/sections";

function Group({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="space-y-2">
      <div id={`${id}-head`} className="flex items-center justify-between">
        <h3 id={`${id}-title`} className="font-display text-[20px] leading-none text-text-primary">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ProfileDrawer(props: {
  profile: Profile;
  models: ModelList | null;
  onSave: (p: Profile) => Promise<void>;
  onClose: () => void;
  onRestart: () => void;
  onClear: () => void;
  onManageModels?: () => void;
  recentChats?: ReactNode;
}) {
  const [draft, setDraft] = useState<Profile>(props.profile);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useOnboardingOptions(draft.home);
  const { onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await props.onSave(draft);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div id="profile-drawer" className="fixed inset-0 z-40 flex justify-end">
      <button
        id="profile-drawer-backdrop"
        type="button"
        aria-label="Close profile"
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
      />
      <aside
        id="profile-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        className="relative flex h-full w-full max-w-[480px] animate-rise flex-col border-l border-border bg-bg shadow-lift"
      >
        <header id="profile-drawer-header" className="flex items-center justify-between px-6 pt-6">
          <div id="profile-drawer-who" className="flex items-center gap-3">
            <span
              id="profile-drawer-avatar"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-accent font-medium text-text-primary"
            >
              {initials(draft.name) || "?"}
            </span>
            <div id="profile-drawer-heading">
              <h2 id="profile-drawer-title" className="font-display text-[26px] leading-none text-text-primary">
                {draft.name?.trim() || "Your profile"}
              </h2>
              <p id="profile-drawer-sub" className="eyebrow mt-1.5">
                Saved to your account
              </p>
            </div>
          </div>
          <button
            id="profile-drawer-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition hover:bg-surface hover:text-text-primary"
          >
            <X id="profile-drawer-close-icon" aria-hidden="true" size={16} />
          </button>
        </header>
        <div id="profile-drawer-body" className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
          {props.recentChats && (
            <Group id="profile-group-chats" title="Recent chats">
              {props.recentChats}
            </Group>
          )}
          <Group id="profile-group-you" title="You">
            <YouSection id="profile-you" profile={draft} onChange={setDraft} options={options} />
          </Group>
          <Group id="profile-group-travel" title="Travel">
            <TravelSection id="profile-travel" profile={draft} onChange={setDraft} options={options} />
          </Group>
          <Group id="profile-group-shopping" title="Shopping">
            <ShoppingSection id="profile-shopping" profile={draft} onChange={setDraft} options={options} />
          </Group>
          <Group
            id="profile-group-model"
            title="Default model"
            action={
              props.onManageModels && (
                <button
                  id="profile-manage-models"
                  type="button"
                  onClick={props.onManageModels}
                  className="text-xs text-mist-600 underline underline-offset-2"
                >
                  Manage models
                </button>
              )
            }
          >
            <ModelOptions
              id="profile-model-options"
              models={props.models}
              value={draft.defaultModel}
              onChange={(id) => setDraft({ ...draft, defaultModel: id })}
            />
          </Group>
          <Group id="profile-group-notes" title="Anything else">
            <label id="profile-notes-label" htmlFor="profile-notes-input" className="sr-only">
              Anything else I should keep in mind?
            </label>
            <textarea
              id="profile-notes-input"
              rows={3}
              maxLength={1000}
              value={draft.notes ?? ""}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Anything else I should keep in mind?"
              className="w-full resize-none rounded-xl border border-border bg-paper px-3.5 py-2.5 text-[15px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300"
            />
          </Group>
          <p id="profile-drawer-note" className="text-xs leading-relaxed text-text-muted">
            Profile changes apply to new chats. To change the model for this chat, use the menu in the header.
          </p>
          <div id="profile-drawer-danger" className="space-y-2 border-t border-border pt-5">
            <button
              id="profile-restart"
              type="button"
              onClick={props.onRestart}
              className="block text-sm text-text-secondary underline-offset-4 hover:underline"
            >
              Run setup again
            </button>
            <SignOutForm
              id="profile-signout-all"
              scope="global"
              className="block text-sm text-text-secondary underline-offset-4 hover:underline"
            >
              Sign out everywhere
            </SignOutForm>
            {confirming ? (
              <div id="profile-clear-confirm" className="flex items-center gap-2 text-sm">
                <span id="profile-clear-question" className="text-text-secondary">
                  Clear everything I know about you?
                </span>
                <button
                  id="profile-clear-yes"
                  type="button"
                  onClick={props.onClear}
                  className="rounded-full bg-danger-bg px-3 py-1 text-xs font-medium text-danger-fg"
                >
                  Yes, clear
                </button>
                <button id="profile-clear-no" type="button" onClick={() => setConfirming(false)} className="text-xs text-text-muted">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                id="profile-clear"
                type="button"
                onClick={() => setConfirming(true)}
                className="block text-sm text-danger-fg underline-offset-4 hover:underline"
              >
                Clear profile
              </button>
            )}
          </div>
        </div>
        <footer id="profile-drawer-footer" className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          {error && (
            <p id="profile-save-error" role="alert" className="mr-auto text-xs text-danger-fg">
              {error}
            </p>
          )}
          <button
            id="profile-cancel"
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-border-strong"
          >
            Cancel
          </button>
          <button
            id="profile-save"
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-full bg-charcoal px-5 py-2 text-sm font-medium text-on-charcoal transition hover:opacity-85 disabled:opacity-40"
          >
            Save
          </button>
        </footer>
      </aside>
    </div>
  );
}
