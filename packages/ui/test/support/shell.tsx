import { emptyProfile, type Profile } from "@oab/shared/profile";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { ShellOverlays } from "../../src/components/shell/ShellOverlays.tsx";
import { ShellProvider } from "../../src/components/shell/ShellProvider.tsx";
import type { ModelList } from "../../src/lib/models.ts";
import type { Platform } from "../../src/platform/index.ts";
import { shellPlatform, withPlatform } from "./platform.tsx";

export { nav } from "./navigation.tsx";

export const models: ModelList = { default: "openrouter/a", models: [{ id: "openrouter/a", label: "Model A", provider: "OpenRouter" }] };

export const profile = (over: Partial<Profile> = {}): Profile => ({
  ...emptyProfile(),
  name: "Nitin Bhat",
  onboardedAt: "2026-10-30",
  ...over,
});

export function renderShell(ui: ReactNode, opts: { profile?: Profile; save?: (p: Profile) => Promise<void>; platform?: Platform } = {}) {
  const save = opts.save ?? vi.fn(async () => {});
  const wrap = (node: ReactNode) =>
    withPlatform(
      <ShellProvider profile={opts.profile ?? profile()} saveProfile={save} models={models} reloadModels={() => {}}>
        {node}
        <ShellOverlays />
      </ShellProvider>,
      opts.platform ?? shellPlatform(),
    );
  const utils = render(wrap(ui));
  return { ...utils, rerender: (next: ReactNode) => utils.rerender(wrap(next)), save };
}

export const flush = () => act(async () => {});
