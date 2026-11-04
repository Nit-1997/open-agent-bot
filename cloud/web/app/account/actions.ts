"use server";

import { type ActionResult, failure } from "@/lib/actionResult";
import { DELETE_ACCOUNT_COPY } from "@/lib/accountCopy";
import { callAgent, jsonBody, withAgentAuth } from "@/lib/agentCall";
import { dropSessionCookies } from "@/lib/supabase/session";

const EMAIL_MAX = 320;

export async function deleteOwnAccount(confirmEmail: unknown): Promise<ActionResult<{ ok: true }>> {
  if (typeof confirmEmail !== "string" || !confirmEmail.trim() || confirmEmail.length > EMAIL_MAX)
    return failure(400, "invalid", DELETE_ACCOUNT_COPY.confirmNeeded);
  const result = await withAgentAuth((auth) =>
    callAgent<{ ok: true }>("/account/delete", auth, { method: "POST", ...jsonBody({ confirmEmail: confirmEmail.trim() }) }),
  );
  if (result.ok) await dropSessionCookies();
  return result;
}
