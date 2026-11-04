"use server";

import { headers } from "next/headers";
import { agentFetch } from "@/lib/agentServer";
import { type AccessRequestState, clientIp, parseAccessRequest } from "@/lib/authForms";
import { ConfigError } from "@/lib/env";
import { formTsProblem, freshFormTs } from "@/lib/formToken";

const SENT: AccessRequestState = { status: "sent" };
const UNAVAILABLE = "Can't send your request right now. Try again in a minute.";

export async function submitAccessRequest(_prev: AccessRequestState, form: FormData): Promise<AccessRequestState> {
  const parsed = parseAccessRequest(form);
  if (!parsed.ok) return { status: "invalid", values: parsed.values, fieldErrors: parsed.fieldErrors };
  const honeypot = form.get("oab_trap");
  const formToken = form.get("form_ts");
  const dropped = typeof honeypot === "string" && honeypot !== "" ? "honeypot" : formTsProblem(formToken);
  if (dropped) {
    console.warn(`[access] request dropped reason=${dropped}`);
    return SENT;
  }

  const ip = clientIp(await headers());
  try {
    const res = await agentFetch("/access-requests", null, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip && { "x-client-ip": ip }) },
      body: JSON.stringify({ ...parsed.value, formToken }),
    });
    if (res.status >= 500) return { status: "error", values: parsed.value, message: UNAVAILABLE, formTs: freshFormTs() };
    if (res.status === 400) return { status: "invalid", values: parsed.value, message: "Check the fields and try again." };
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    return { status: "error", values: parsed.value, message: UNAVAILABLE, formTs: freshFormTs() };
  }
  return SENT;
}
