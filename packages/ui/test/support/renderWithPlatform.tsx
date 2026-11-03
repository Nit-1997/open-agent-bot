import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  memoryRouter,
  type Platform,
  PlatformProvider,
  type PlatformRouter,
  type PlatformSlots,
  type PlatformUser,
} from "../../src/platform/index.ts";

export const TEST_USER: PlatformUser = { email: "ntn@example.test", name: "Nitin Bhat" };

export function testPlatform(opts: { router?: PlatformRouter; user?: PlatformUser; slots?: PlatformSlots } = {}): Platform {
  return { router: opts.router ?? memoryRouter("/"), user: opts.user ?? TEST_USER, slots: opts.slots ?? {} };
}

export function renderWithPlatform(
  ui: ReactNode,
  opts: { path?: string; router?: PlatformRouter; user?: PlatformUser; slots?: PlatformSlots } = {},
) {
  const router = opts.router ?? memoryRouter(opts.path ?? "/");
  const platform = testPlatform({ ...opts, router });
  const wrap = (node: ReactNode) => <PlatformProvider platform={platform}>{node}</PlatformProvider>;
  const utils = render(wrap(ui));
  return { ...utils, platform, router, rerender: (next: ReactNode) => utils.rerender(wrap(next)) };
}
