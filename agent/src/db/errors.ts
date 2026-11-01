import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";

export type DbFailure = { code?: string | null; message?: string; details?: string | null; status?: number };

export const isTransportFailure = (e: DbFailure) => !e.code || e.status === 0;

export function dbError(where: string, e: DbFailure): UserError {
  if (isTransportFailure(e)) {
    log.warn(`[db] ${where} unreachable`);
    return new UserError("The data service isn't reachable. Try again in a minute.", "unavailable");
  }
  switch (e.code) {
    case "23505":
      return new UserError("That already exists.", "conflict");
    case "23503":
      return new UserError("That doesn't exist.", "not_found");
    case "23514":
    case "22P02":
      return new UserError("That value isn't valid.", "invalid");
    default:
      log.error(`[db] ${where} failed code=${e.code}`);
      return new UserError("The data service returned an error.", "upstream");
  }
}

type Result<T> = { data: T | null; error: DbFailure | null; status?: number; count?: number | null };

export const DB_TIMEOUT_MS = 10_000;
export const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);

export async function must<T>(where: string, q: PromiseLike<Result<T>>): Promise<{ data: T | null; count: number | null }> {
  const res = await q;
  if (res.error) throw dbError(where, { ...res.error, status: res.status });
  return { data: res.data, count: res.count ?? null };
}

export async function read<T>(where: string, q: () => PromiseLike<Result<T>>): Promise<{ data: T | null; count: number | null }> {
  const first = await q();
  if (first.error && isTransportFailure({ ...first.error, status: first.status })) return must(where, q());
  return must(where, Promise.resolve(first));
}
