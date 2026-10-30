import type { Profile } from "../../../shared/profile.js";

export type ProfileOverride = Partial<Profile>;
export type Viewport = { width: number; height: number };
export type UserContext = {
  timeZone: string;
  locale: string;
  localTime: string;
  model?: string;
  profile?: ProfileOverride;
  viewport?: Viewport;
};
