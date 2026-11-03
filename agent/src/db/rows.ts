import { PAGE_SIZE } from "@oab/shared/pages";

export function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`unexpected ${column} value in the database`);
}

export const pageOffset = (page: number, size: number = PAGE_SIZE) => (Math.max(1, Math.floor(page)) - 1) * size;

export const likePrefix = (q: string) => `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
