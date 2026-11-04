import type { ReactNode } from "react";
import { hostedTestPlatform, withPlatform } from "../support/platform";

export const wrapGolden = (ui: ReactNode, opts: { isAdmin?: boolean } = {}) => withPlatform(ui, hostedTestPlatform(opts));
