import { emptyProfile, type Profile } from "@shared/profile";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
export { nav } from "./navigation";
import { vi } from "vitest";
import { ShellOverlays } from "@/components/shell/ShellOverlays";
import { ShellProvider } from "@/components/shell/ShellProvider";
import type { ModelList } from "@/lib/models";

export const models: ModelList = { default: "openrouter/a", models: [{ id: "openrouter/a", label: "Model A", provider: "OpenRouter" }] };

export const profile = (over: Partial<Profile> = {}): Profile => ({
  ...emptyProfile(),
  name: "Nitin Bhat",
  onboardedAt: "2026-10-30",
  ...over,
});

export function renderShell(ui: ReactNode, opts: { profile?: Profile; save?: (p: Profile) => Promise<void> } = {}) {
  const save = opts.save ?? vi.fn(async () => {});
  const wrap = (node: ReactNode) => (
    <ShellProvider
      user={{ email: "ntn@example.test", name: "Nitin Bhat", isAdmin: false }}
      profile={opts.profile ?? profile()}
      saveProfile={save}
      models={models}
      reloadModels={() => {}}
    >
      {node}
      <ShellOverlays />
    </ShellProvider>
  );
  const utils = render(wrap(ui));
  return { ...utils, rerender: (next: ReactNode) => utils.rerender(wrap(next)), save };
}

export const flush = () => act(async () => {});
