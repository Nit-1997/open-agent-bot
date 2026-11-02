"use client";

import { useCallback, useSyncExternalStore } from "react";

type MessageSource<M> = {
  messages: M[];
  subscribe(s: { onMessagesChanged?: () => void }): { unsubscribe(): void };
};

type Snapshot<M> = { source: M[]; length: number; last: M | undefined; value: readonly M[] };

const snapshots = new WeakMap<object, Snapshot<unknown>>();

export function messagesSnapshot<M>(agent: MessageSource<M>): readonly M[] {
  const source = agent.messages;
  const last = source.at(-1);
  const seen = snapshots.get(agent) as Snapshot<M> | undefined;
  if (seen && seen.source === source && seen.length === source.length && seen.last === last) return seen.value;
  const next: Snapshot<M> = { source, length: source.length, last, value: [...source] };
  snapshots.set(agent, next);
  return next.value;
}

export function useAgentMessages<M>(agent: MessageSource<M>): readonly M[] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const sub = agent.subscribe({ onMessagesChanged: onChange });
      return () => sub.unsubscribe();
    },
    [agent],
  );
  const read = useCallback(() => messagesSnapshot(agent), [agent]);
  return useSyncExternalStore(subscribe, read, read);
}
