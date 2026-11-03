import type { Principal } from "../identity/types.js";
import type { UserError } from "../lib/errors.js";

export type RunRequest = Readonly<{ principal: Principal; chatId: string; runId: string }>;

export interface RunTicket {
  end(): void;
}

export type Admission = { ok: true; ticket: RunTicket } | { ok: false; error: UserError };

export interface RunPolicy {
  admit(run: RunRequest): Promise<Admission>;
}
