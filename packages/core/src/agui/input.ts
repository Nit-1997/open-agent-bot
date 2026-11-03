import type { Message, RunAgentInput } from "@ag-ui/core";
import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import { parseWorkspaceEdits, type WorkspaceEdits } from "@oab/shared/workspace";
import { type Profile, parseProfile } from "@oab/shared/profile";
import type { ProfileOverride, UserContext, Viewport } from "../prompt/userContext.js";
import type { HistoryMessage } from "../session/sessionStore.js";

export function messageText(m: Message): string {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p?.type === "text" ? p.text : "")).join("");
  return "";
}

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function readProfile(v: unknown): ProfileOverride | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const { agent: _persona, ...raw } = v as Record<string, unknown>;
  const homeText = clip(raw.home, 200);
  if (homeText) raw.home = { label: homeText, city: homeText };
  const parsed = parseProfile(raw);
  if (!parsed) return undefined;
  const override = Object.fromEntries(Object.keys(raw).flatMap((k) => (k in parsed ? [[k, parsed[k as keyof Profile]]] : [])));
  return Object.keys(override).length ? (override as ProfileOverride) : undefined;
}

function readViewport(v: unknown): Viewport | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { width, height } = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 200 && n <= 10000;
  return ok(width) && ok(height) ? { width: Math.round(width), height: Math.round(height) } : undefined;
}

export function readUserContext(input: RunAgentInput): UserContext | null {
  const item = input.context?.find((c) => c.description === "user_context");
  if (!item) return null;
  try {
    const v = typeof item.value === "string" ? JSON.parse(item.value) : item.value;
    if (v && typeof v.timeZone === "string" && typeof v.locale === "string" && typeof v.localTime === "string") {
      const model = clip(v.model, 100);
      const profile = readProfile(v.profile);
      const viewport = readViewport(v.viewport);
      return {
        timeZone: v.timeZone,
        locale: v.locale,
        localTime: v.localTime,
        ...(model && { model }),
        ...(profile && { profile }),
        ...(viewport && { viewport }),
      };
    }
  } catch {}
  return null;
}

function contextValue(input: RunAgentInput, description: string): unknown {
  const item = input.context?.find((c) => c.description === description);
  if (!item?.value) return undefined;
  try {
    return typeof item.value === "string" ? JSON.parse(item.value) : item.value;
  } catch {
    return undefined;
  }
}

export function readWorkspaceEdits(input: RunAgentInput): WorkspaceEdits | null {
  return parseWorkspaceEdits(contextValue(input, "workspace_edits"));
}

export function readOpenReport(input: RunAgentInput): string | null {
  const v = contextValue(input, "open_report") as { openReport?: { id?: unknown } } | undefined;
  const id = v && typeof v === "object" ? v.openReport?.id : undefined;
  return typeof id === "string" && ARTIFACT_ID_RE.test(id) ? id : null;
}

const HISTORY_LIMIT = 40;
const HISTORY_CLIP = 4000;

export function historyFromStored(messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>): HistoryMessage[] {
  const turns = messages.flatMap((m): HistoryMessage[] => {
    const text = m.content.trim().slice(0, HISTORY_CLIP);
    return text ? [{ role: m.role, text }] : [];
  });
  const merged = turns.reduce<HistoryMessage[]>((out, t) => {
    const prev = out.at(-1);
    if (prev?.role === t.role) prev.text = `${prev.text}\n\n${t.text}`;
    else out.push({ ...t });
    return out;
  }, []);
  const recent = merged.slice(-HISTORY_LIMIT);
  return recent[0]?.role === "assistant" ? recent.slice(1) : recent;
}
