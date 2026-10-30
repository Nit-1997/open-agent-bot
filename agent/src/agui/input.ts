import type { Message, RunAgentInput } from "@ag-ui/core";
import { parseWorkspaceEdits, type WorkspaceEdits } from "../../../shared/workspace.js";
import type { UserContext, UserProfile, Viewport } from "../prompt/userContext.js";
import type { HistoryMessage } from "../session/sessionStore.js";

export function messageText(m: Message): string {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p?.type === "text" ? p.text : "")).join("");
  return "";
}

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function readProfile(v: unknown): UserProfile | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const p = v as Record<string, unknown>;
  const interests = Array.isArray(p.interests)
    ? p.interests
        .map((i) => clip(i, 40))
        .filter((i): i is string => !!i)
        .slice(0, 12)
    : [];
  const profile: UserProfile = {
    ...(clip(p.name, 80) && { name: clip(p.name, 80) }),
    ...(clip(p.home, 200) && { home: clip(p.home, 200) }),
    ...(interests.length && { interests }),
    ...(clip(p.notes, 1000) && { notes: clip(p.notes, 1000) }),
  };
  return Object.keys(profile).length ? profile : undefined;
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

const HISTORY_LIMIT = 40;
const HISTORY_CLIP = 4000;

export function restoreHistory(messages: Message[]): HistoryMessage[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const turns = messages.slice(0, Math.max(lastUser, 0)).flatMap((m): HistoryMessage[] => {
    const text = messageText(m).trim().slice(0, HISTORY_CLIP);
    return (m.role === "user" || m.role === "assistant") && text ? [{ role: m.role, text }] : [];
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
