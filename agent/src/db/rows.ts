import { PAGE_SIZE } from "../../../shared/pages.js";

export function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`unexpected ${column} value in the database`);
}

export const pageOffset = (page: number) => (Math.max(1, Math.floor(page)) - 1) * PAGE_SIZE;

export const likePrefix = (q: string) => `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
