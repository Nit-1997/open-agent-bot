"use client";

import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { Onboarding } from "@/components/profile/onboarding/Onboarding";
import { AccessDisabled, SignedOutBanner } from "@/components/session/SignedOutBanner";
import { useAuthState } from "@/lib/authState";
import { useModels } from "@/lib/models";
import { type Profile, saveProfile, useProfile } from "@/lib/profile";
import { ShellFrame } from "./ShellFrame";
import { ShellOverlays } from "./ShellOverlays";
import { ShellProvider, type ShellUser } from "./ShellProvider";

function ProfileLoading({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div id="shell-profile-loading" className="flex h-dvh w-full flex-col items-center justify-center gap-3 px-4">
      <AgentOrb id="shell-profile-loading-orb" look="mist" size={40} breathing />
      {error ? (
        <>
          <p id="shell-profile-loading-error" role="alert" className="text-sm text-danger-fg">
            {`Couldn't reach the agent: ${error}`}
          </p>
          <button
            id="shell-profile-loading-retry"
            type="button"
            onClick={onRetry}
            className="rounded-full border border-border px-4 py-1.5 text-sm text-text-secondary transition hover:border-border-strong"
          >
            Try again
          </button>
        </>
      ) : (
        <p id="shell-profile-loading-text" className="text-sm text-text-muted">
          Loading…
        </p>
      )}
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const authState = useAuthState();
  const { profile: stored, error, reload } = useProfile();
  const profile = useMemo(
    () => (stored && !stored.name?.trim() && user.name ? { ...stored, name: user.name } : stored),
    [stored, user.name],
  );
  const { list: models, reload: reloadModels } = useModels();
  const [starter, setStarter] = useState<string | undefined>(undefined);

  const save = useCallback(
    async (p: Profile) => {
      await saveProfile(p);
      reloadModels();
    },
    [reloadModels],
  );

  if (authState === "account_disabled") return <AccessDisabled />;
  const signedOut = authState === "signed_out" && <SignedOutBanner />;
  if (!profile) {
    return (
      <>
        {signedOut}
        <ProfileLoading error={error} onRetry={reload} />
      </>
    );
  }
  if (!profile.onboardedAt) {
    return (
      <>
        {signedOut}
        <Onboarding
          profile={profile}
          models={models}
          onModelsChanged={reloadModels}
          onDone={async (p, s) => {
            await save(p);
            setStarter(s ?? undefined);
          }}
        />
      </>
    );
  }
  return (
    <ShellProvider user={user} profile={profile} saveProfile={save} models={models} reloadModels={reloadModels} starter={starter}>
      {signedOut}
      <ShellFrame>{children}</ShellFrame>
      <ShellOverlays />
    </ShellProvider>
  );
}
