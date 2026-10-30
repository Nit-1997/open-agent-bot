export type UserProfile = { name?: string; home?: string; interests?: string[]; notes?: string };
export type Viewport = { width: number; height: number };
export type UserContext = {
  timeZone: string;
  locale: string;
  localTime: string;
  model?: string;
  profile?: UserProfile;
  viewport?: Viewport;
};
