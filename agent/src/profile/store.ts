import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { emptyProfile, type Profile, parseProfile } from "../../../shared/profile.js";
import { UserError } from "../lib/errors.js";
import { readJsonFile, writeFileAtomic } from "../lib/files.js";

export interface ProfileStore {
  get(): Promise<Profile>;
  put(profile: unknown): Promise<Profile>;
}

export class FileProfileStore implements ProfileStore {
  private cached: Profile | undefined;
  private writing: Promise<unknown> = Promise.resolve();

  private constructor(private readonly path: string) {}

  static at(dataDir: string): FileProfileStore {
    return new FileProfileStore(join(dataDir, "profile.json"));
  }

  async get(): Promise<Profile> {
    if (this.cached) return structuredClone(this.cached);
    const raw = await readJsonFile<unknown>(this.path);
    this.cached = (raw !== undefined && parseProfile(raw)) || emptyProfile();
    return structuredClone(this.cached);
  }

  async put(input: unknown): Promise<Profile> {
    const profile = parseProfile(input);
    if (!profile) throw new UserError("that profile isn't valid");
    const write = this.writing.then(async () => {
      await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
      await writeFileAtomic(this.path, JSON.stringify(profile, null, 2));
      this.cached = profile;
    });
    this.writing = write.catch(() => {});
    await write;
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
    if (!profile) throw new UserError("that profile isn't valid");
    this.profile = profile;
    return structuredClone(profile);
  }
}
