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

type Result = { data: unknown; error: DbFailure | null; status?: number; count?: number | null };
type Rows<R extends Result> = { data: R["data"] | null; count: number | null };

export async function must<R extends Result>(where: string, q: PromiseLike<R>): Promise<Rows<R>> {
  const res = await q;
  if (res.error) throw dbError(where, { ...res.error, status: res.status });
  return { data: res.data, count: res.count ?? null };
}

export async function read<R extends Result>(where: string, q: () => PromiseLike<R>): Promise<Rows<R>> {
  const first = await q();
  if (first.error && isTransportFailure({ ...first.error, status: first.status })) return must(where, q());
  return must(where, Promise.resolve(first));
}

const RANGE_NOT_SATISFIABLE = "PGRST103";

export async function readPage<R extends Result>(
  where: string,
  q: () => PromiseLike<R>,
  count: () => PromiseLike<Result>,
): Promise<{ data: R["data"] | null; total: number }> {
  const res = await q();
  if (res.error?.code === RANGE_NOT_SATISFIABLE) {
    const { count: total } = await read(`${where}.count`, count);
    return { data: null, total: total ?? 0 };
  }
  const { data, count: total } = await read(where, () => Promise.resolve(res));
  return { data, total: total ?? 0 };
}
