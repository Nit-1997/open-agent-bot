import { createHash, timingSafeEqual } from "node:crypto";

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

export function secretMatches(given: string | undefined, expected: string): boolean {
  return timingSafeEqual(digest(given ?? ""), digest(expected)) && given !== undefined;
}
