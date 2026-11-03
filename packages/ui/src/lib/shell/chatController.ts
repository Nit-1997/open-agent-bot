import type { HistoryMessage } from "@/lib/chats";

export const MAX_PANES = 3;
export const MAX_PANELS = 20;

export type ThreadStatus = "draft" | "loading" | "ready" | "missing" | "error";

export type Thread = {
  id: string;
  status: ThreadStatus;
  title: string;
  history?: HistoryMessage[];
  cardDates?: Record<string, string>;
  error?: string;
  model?: string;
  starter?: string;
  used: boolean;
  claimed: boolean;
  attempt: number;
  runFlags?: RunFlags;
};

export type RunFlags = { dismissed: boolean; picked: boolean };
export type PanelHow = "user" | "auto" | "url";
export type Panel = { reportId: string; how: PanelHow; pushed: boolean };

export type ChatState = {
  draftId: string;
  activeId: string;
  threads: Record<string, Thread>;
  running: string[];
  panels: Record<string, Panel>;
};

export type ChatAction =
  | { type: "showDraft"; freshId: string }
  | { type: "newDraft"; id: string; starter?: string }
  | { type: "open"; id: string }
  | { type: "loaded"; id: string; title: string; history: HistoryMessage[]; cardDates?: Record<string, string> }
  | { type: "failed"; id: string; missing: boolean; error?: string }
  | { type: "retry"; id: string }
  | { type: "running"; id: string; running: boolean }
  | { type: "claimed"; id: string; title: string }
  | { type: "model"; id: string; model: string }
  | { type: "openReport"; id: string; reportId: string; how: PanelHow; pushed?: boolean }
  | { type: "closeReport"; id: string };

const draft = (id: string, starter?: string): Thread => ({
  id,
  status: "draft",
  title: "",
  used: false,
  claimed: false,
  attempt: 0,
  ...(starter && { starter }),
});

export function initialChatState(draftId: string, starter?: string): ChatState {
  return { draftId, activeId: draftId, threads: { [draftId]: draft(draftId, starter) }, running: [], panels: {} };
}

export const paneId = (threadId: string) => `chat-pane-${threadId}`;
export const composerInputId = (threadId: string) => `${paneId(threadId)}-composer-input`;

export function mountedIds(s: ChatState): string[] {
  const keep = new Set([s.activeId, ...s.running.filter((id) => id !== s.activeId).slice(-(MAX_PANES - 1))]);
  return Object.keys(s.threads).filter((id) => keep.has(id));
}

function prune(s: ChatState): ChatState {
  const keep = new Set([s.draftId, ...mountedIds(s)]);
  const threads = Object.fromEntries(Object.entries(s.threads).filter(([id]) => keep.has(id)));
  return { ...s, threads };
}

const patch = (s: ChatState, id: string, p: Partial<Thread>): ChatState =>
  s.threads[id] ? { ...s, threads: { ...s.threads, [id]: { ...s.threads[id], ...p } } } : s;

function flag(s: ChatState, id: string, key: keyof RunFlags): ChatState {
  const t = s.threads[id];
  if (!t || !s.running.includes(id)) return s;
  return patch(s, id, { runFlags: { dismissed: false, picked: false, ...t.runFlags, [key]: true } });
}

function withPanel(panels: Record<string, Panel>, id: string, panel: Panel): Record<string, Panel> {
  const rest = { ...panels };
  delete rest[id];
  const keys = Object.keys(rest);
  const drop = new Set(keys.slice(0, Math.max(0, keys.length + 1 - MAX_PANELS)));
  return { ...Object.fromEntries(Object.entries(rest).filter(([k]) => !drop.has(k))), [id]: panel };
}

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case "showDraft": {
      const current = s.threads[s.draftId];
      if (current && !current.claimed) return prune({ ...s, activeId: s.draftId });
      return prune({ ...s, draftId: a.freshId, activeId: a.freshId, threads: { ...s.threads, [a.freshId]: draft(a.freshId) } });
    }
    case "newDraft":
      return prune({ ...s, draftId: a.id, activeId: a.id, threads: { ...s.threads, [a.id]: draft(a.id, a.starter) } });
    case "open": {
      if (s.threads[a.id]) return prune({ ...s, activeId: a.id });
      const loading: Thread = { id: a.id, status: "loading", title: "", used: true, claimed: true, attempt: 0 };
      return prune({ ...s, activeId: a.id, threads: { ...s.threads, [a.id]: loading } });
    }
    case "loaded":
      return patch(s, a.id, { status: "ready", title: a.title, history: a.history, cardDates: a.cardDates, error: undefined });
    case "failed":
      return patch(s, a.id, { status: a.missing ? "missing" : "error", error: a.error });
    case "retry": {
      const t = s.threads[a.id];
      return t ? patch(s, a.id, { status: "loading", error: undefined, attempt: t.attempt + 1 }) : s;
    }
    case "running": {
      const others = s.running.filter((id) => id !== a.id);
      const next = { ...s, running: a.running ? [...others, a.id] : others };
      return prune(a.running ? patch(next, a.id, { used: true, runFlags: { dismissed: false, picked: false } }) : next);
    }
    case "claimed":
      return patch(s, a.id, { claimed: true, title: s.threads[a.id]?.title || a.title, status: "ready" });
    case "model":
      return patch(s, a.id, { model: a.model });
    case "openReport": {
      const current = s.panels[a.id];
      if (current?.reportId === a.reportId) return s;
      const next = { ...s, panels: withPanel(s.panels, a.id, { reportId: a.reportId, how: a.how, pushed: a.pushed ?? false }) };
      return a.how === "user" ? flag(next, a.id, "picked") : next;
    }
    case "closeReport": {
      if (!s.panels[a.id]) return s;
      const panels = { ...s.panels };
      delete panels[a.id];
      return flag({ ...s, panels }, a.id, "dismissed");
    }
  }
}

export const isUntouchedDraft = (t: Thread | undefined) => !!t && t.status === "draft" && !t.used && !t.claimed;
