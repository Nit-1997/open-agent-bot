import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUTH_DIR } from "./hostedEnv";
import type { Seeded } from "./seed";

const FILE = resolve(AUTH_DIR, "seed.json");

export const saveSeeded = (s: Seeded) => writeFileSync(FILE, JSON.stringify(s));
export const seeded = (): Seeded => JSON.parse(readFileSync(FILE, "utf8")) as Seeded;
