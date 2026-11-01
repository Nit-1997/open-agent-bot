import type { HistoryMessage } from "@/lib/chats";

export const MAX_PANES = 3;

export type ThreadStatus = "draft" | "loading" | "ready" | "missing" | "error";

export type Thread = {
  id: string;
  status: ThreadStatus;
  title: string;
  history?: HistoryMessage[];
  error?: string;
  model?: string;
  starter?: string;
  used: boolean;
  claimed: boolean;
  attempt: number;
};

export type ChatState = { draftId: string; activeId: string; threads: Record<string, Thread>; running: string[] };

export type ChatAction =
  | { type: "showDraft"; freshId: string }
  | { type: "newDraft"; id: string; starter?: string }
  | { type: "open"; id: string }
  | { type: "loaded"; id: string; title: string; history: HistoryMessage[] }
  | { type: "failed"; id: string; missing: boolean; error?: string }
  | { type: "retry"; id: string }
  | { type: "running"; id: string; running: boolean }
  | { type: "claimed"; id: string; title: string }
  | { type: "model"; id: string; model: string };

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
  return { draftId, activeId: draftId, threads: { [draftId]: draft(draftId, starter) }, running: [] };
}

export function mountedIds(s: ChatState): string[] {
  const running = s.running.filter((id) => id !== s.activeId).slice(-(MAX_PANES - 1));
  return [s.activeId, ...running].filter((id) => s.threads[id]);
}

function prune(s: ChatState): ChatState {
  const keep = new Set([s.draftId, ...mountedIds(s)]);
  const threads = Object.fromEntries(Object.entries(s.threads).filter(([id]) => keep.has(id)));
  return { ...s, threads };
}

const patch = (s: ChatState, id: string, p: Partial<Thread>): ChatState =>
  s.threads[id] ? { ...s, threads: { ...s.threads, [id]: { ...s.threads[id], ...p } } } : s;

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
      return patch(s, a.id, { status: "ready", title: a.title, history: a.history, error: undefined });
    case "failed":
      return patch(s, a.id, { status: a.missing ? "missing" : "error", error: a.error });
    case "retry": {
      const t = s.threads[a.id];
      return t ? patch(s, a.id, { status: "loading", error: undefined, attempt: t.attempt + 1 }) : s;
    }
    case "running": {
      const others = s.running.filter((id) => id !== a.id);
      const next = { ...s, running: a.running ? [...others, a.id] : others };
      return prune(a.running ? patch(next, a.id, { used: true }) : next);
    }
    case "claimed":
      return patch(s, a.id, { claimed: true, title: s.threads[a.id]?.title || a.title, status: "ready" });
    case "model":
      return patch(s, a.id, { model: a.model });
  }
}

export const isUntouchedDraft = (t: Thread | undefined) => !!t && t.status === "draft" && !t.used && !t.claimed;
