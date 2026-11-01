"use client";

import { type ChatSummary, chatTitleFrom } from "@shared/chats";
import { CHATS_PAGE_SIZE } from "@shared/lists";
import type { PageResponse } from "@shared/pages";
import { useEffect, useSyncExternalStore } from "react";
import { chatsApi } from "@/lib/chats";
import { errorMessage } from "@/lib/errors";

export type ChatIndexState = {
  status: "idle" | "loading" | "ready" | "error";
  items: ChatSummary[];
  total: number;
  pages: number;
  error?: string;
  loadingMore: boolean;
  moreError?: string;
};

const INITIAL: ChatIndexState = { status: "idle", items: [], total: 0, pages: 0, loadingMore: false };

let state: ChatIndexState = INITIAL;
const listeners = new Set<() => void>();
let generation = 0;

const set = (next: ChatIndexState) => {
  state = next;
  for (const l of listeners) l();
};

const dedupe = (items: ChatSummary[]) => [...new Map(items.map((c) => [c.id, c])).values()];

async function loadPages(count: number): Promise<{ items: ChatSummary[]; total: number }> {
  const items: ChatSummary[] = [];
  let total = 0;
  for (let page = 1; page <= Math.max(1, count); page++) {
    const res = await chatsApi.page(page);
    items.push(...res.items);
    total = res.total;
    if (res.items.length < CHATS_PAGE_SIZE) break;
  }
  return { items: dedupe(items), total };
}

export const chatIndex = {
  get: () => state,
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  async load(): Promise<void> {
    const mine = ++generation;
    set({ ...state, status: state.items.length ? state.status : "loading", error: undefined });
    try {
      let fetched = state.pages || 1;
      let page = await loadPages(fetched);
      while (mine === generation && state.pages > fetched) {
        fetched = state.pages;
        page = await loadPages(fetched);
      }
      if (mine === generation)
        set({
          ...state,
          status: "ready",
          items: page.items,
          total: page.total,
          pages: Math.max(1, Math.ceil(page.items.length / CHATS_PAGE_SIZE)),
        });
    } catch (e) {
      if (mine === generation) set({ ...state, status: state.items.length ? "ready" : "error", error: errorMessage(e) });
    }
  },
  refresh(): Promise<void> {
    return chatIndex.load();
  },
  async more(): Promise<void> {
    if (state.loadingMore || state.items.length >= state.total) return;
    const mine = generation;
    const next = state.pages + 1;
    set({ ...state, loadingMore: true, moreError: undefined });
    let res: PageResponse<ChatSummary> | undefined;
    let failure: string | undefined;
    try {
      res = await chatsApi.page(next);
    } catch (e) {
      failure = errorMessage(e);
    }
    if (mine !== generation) {
      if (state.loadingMore) set({ ...state, loadingMore: false });
      return;
    }
    if (res) set({ ...state, loadingMore: false, items: dedupe([...state.items, ...res.items]), total: res.total, pages: next });
    else set({ ...state, loadingMore: false, moreError: failure });
  },
  addOptimistic(id: string, prompt: string): void {
    if (state.items.some((c) => c.id === id)) return;
    const row: ChatSummary = { id, title: chatTitleFrom(prompt), lastMessageAt: new Date().toISOString() };
    set({ ...state, items: [row, ...state.items], total: state.total + 1 });
  },
  reset(): void {
    generation++;
    set(INITIAL);
  },
};

export function useChatIndex(): ChatIndexState {
  const current = useSyncExternalStore(chatIndex.subscribe, chatIndex.get, () => INITIAL);
  useEffect(() => {
    if (chatIndex.get().status === "idle") void chatIndex.load();
  }, []);
  return current;
}
