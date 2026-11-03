import { type Platform, PlatformProvider } from "@oab/ui/platform";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { hostedPlatform } from "@/lib/platform/hosted";

export const TEST_USER = { email: "ntn@example.test", name: "Nitin Bhat" };

export const hostedTestPlatform = (): Platform => hostedPlatform(TEST_USER);

export const withPlatform = (ui: ReactNode, platform: Platform = hostedTestPlatform()) => (
  <PlatformProvider platform={platform}>{ui}</PlatformProvider>
);

export function renderWithPlatform(ui: ReactNode, platform: Platform = hostedTestPlatform()) {
  const utils = render(withPlatform(ui, platform));
  return { ...utils, rerender: (next: ReactNode) => utils.rerender(withPlatform(next, platform)) };
}
