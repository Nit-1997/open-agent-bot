import { UserError } from "../../lib/errors.js";
import { log } from "../../lib/log.js";

export type StoreOpenCode = "db_corrupt" | "db_newer" | "db_migration";

export class StoreOpenError extends Error {
  constructor(
    readonly code: StoreOpenCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreOpenError";
  }
}

const SQLITE_BUSY = 5;
const SQLITE_CONSTRAINT = 19;
const CONSTRAINT_CHECK = 275;
const CONSTRAINT_FOREIGNKEY = 787;
const CONSTRAINT_NOTNULL = 1299;
const CONSTRAINT_PRIMARYKEY = 1555;
const CONSTRAINT_UNIQUE = 2067;
const CONSTRAINT_DATATYPE = 3091;

export const errcodeOf = (err: unknown): number | undefined => {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" ? code : undefined;
};

export function sqliteError(where: string, err: unknown): UserError {
  const code = errcodeOf(err);
  switch (code) {
    case CONSTRAINT_PRIMARYKEY:
    case CONSTRAINT_UNIQUE:
      return new UserError("That already exists.", "conflict");
    case CONSTRAINT_FOREIGNKEY:
      return new UserError("That doesn't exist.", "not_found");
    case CONSTRAINT_CHECK:
    case CONSTRAINT_NOTNULL:
    case CONSTRAINT_DATATYPE:
      return new UserError("That value isn't valid.", "invalid");
  }
  if (code !== undefined && (code & 0xff) === SQLITE_BUSY) {
    log.warn(`[db] ${where} busy`);
    return new UserError("The data service is busy. Try again in a minute.", "unavailable");
  }
  log.error(`[db] ${where} failed code=${code ?? "none"}${code !== undefined && (code & 0xff) === SQLITE_CONSTRAINT ? " constraint" : ""}`);
  return new UserError("The data service returned an error.", "upstream");
}
