import { emptyProfile, type Profile, parseProfile, withoutInvalidAgent } from "@oab/shared/profile";
import type { ProfileRepo } from "../store/types.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";

export interface ProfileStore {
  get(): Promise<Profile>;
  put(profile: unknown): Promise<Profile>;
}

const invalid = () => new UserError("that profile isn't valid");

export function readStoredProfile(raw: unknown): Profile {
  const { value, dropped } = withoutInvalidAgent(raw);
  if (dropped) log.warn("[profile] dropped invalid agent");
  return parseProfile(value) ?? emptyProfile();
}

export class SupabaseProfileStore implements ProfileStore {
  constructor(private readonly repo: ProfileRepo) {}

  async get(): Promise<Profile> {
    return readStoredProfile(await this.repo.get());
  }

  async put(input: unknown): Promise<Profile> {
    const profile = parseProfile(input);
    if (!profile) throw invalid();
    await this.repo.putData(profile);
    return structuredClone(profile);
  }
}

export class MemoryProfileStore implements ProfileStore {
  constructor(private profile: Profile = emptyProfile()) {}

  async get(): Promise<Profile> {
    return structuredClone(this.profile);
  }

  async put(input: unknown): Promise<Profile> {
    const profile = parseProfile(input);
    if (!profile) throw invalid();
    this.profile = profile;
    return structuredClone(profile);
  }
}
