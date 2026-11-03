import type { ReactNode } from "react";
import { withPlatform } from "../support/platform";

export const wrapGolden = (ui: ReactNode) => withPlatform(ui);
