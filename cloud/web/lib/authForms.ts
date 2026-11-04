import { normalizeEmail } from "@oab/shared/email";

const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{10,200}$/;
const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

export const NAME_MAX = 100;
export const NOTE_MAX = 1000;

export type FormStatus = "idle" | "sent" | "invalid" | "error";
export type EmailLinkState = { status: FormStatus; message?: string };

export type AccessRequestFields = { name: string; email: string; note: string };
export type AccessRequestState = {
  status: FormStatus;
  formTs?: string;
  message?: string;
  values?: AccessRequestFields;
  fieldErrors?: Partial<Record<keyof AccessRequestFields, string>>;
};

export type ConfirmInput = { type: "invite" | "email"; tokenHash: string; email: string };

const text = (v: FormDataEntryValue | null | undefined): string => (typeof v === "string" ? v : "");

export function parseAccessRequest(
  form: FormData,
): { ok: true; value: AccessRequestFields } | { ok: false; values: AccessRequestFields; fieldErrors: AccessRequestState["fieldErrors"] } {
  const values = { name: text(form.get("name")).trim(), email: text(form.get("email")).trim(), note: text(form.get("note")) };
  const fieldErrors: NonNullable<AccessRequestState["fieldErrors"]> = {};
  if (values.name.length < 1 || values.name.length > NAME_MAX) fieldErrors.name = `Enter your name (up to ${NAME_MAX} characters).`;
  const email = normalizeEmail(values.email);
  if (!email) fieldErrors.email = "Enter a valid email address.";
  if (values.note.length > NOTE_MAX) fieldErrors.note = `Keep the note under ${NOTE_MAX} characters.`;
  if (Object.keys(fieldErrors).length > 0 || !email) return { ok: false, values, fieldErrors };
  return { ok: true, value: { ...values, email } };
}

export function parseConfirmInput(type: unknown, tokenHash: unknown, email: unknown): ConfirmInput | null {
  if (type !== "invite" && type !== "email") return null;
  if (typeof tokenHash !== "string" || !TOKEN_HASH_RE.test(tokenHash)) return null;
  const address = normalizeEmail(typeof email === "string" ? email.replaceAll(" ", "+") : email);
  if (!address) return null;
  return { type, tokenHash, email: address };
}

const firstHop = (value: string | null): string | null => {
  const first = value?.split(",")[0]?.trim() ?? "";
  return IP_RE.test(first) ? first : null;
};

export function clientIp(headers: Headers): string | null {
  return firstHop(headers.get("x-vercel-forwarded-for")) ?? firstHop(headers.get("x-forwarded-for"));
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
