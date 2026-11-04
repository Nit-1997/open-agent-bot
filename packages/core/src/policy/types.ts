import type { Principal } from "../identity/types.js";
import type { UserError } from "../lib/errors.js";

export type RunRequest = Readonly<{ principal: Principal; chatId: string; runId: string }>;

export interface RunTicket {
  end(): void;
  refund?(): void;
}

export type RefundLatch = { refund(): void; close(): void };

export function refundLatch(refund?: () => void): RefundLatch {
  let open = true;
  return {
    refund() {
      if (!open) return;
      open = false;
      refund?.();
    },
    close() {
      open = false;
    },
  };
}

export type Admission = { ok: true; ticket: RunTicket } | { ok: false; error: UserError };

export interface RunPolicy {
  admit(run: RunRequest): Promise<Admission>;
}
