type Listener = () => void;

export function mockViewport(initialWidth: number) {
  let width = initialWidth;
  const lists = new Map<string, { listeners: Set<Listener>; min: number }>();
  const matches = (min: number) => width >= min;
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    const entry = lists.get(query) ?? { listeners: new Set<Listener>(), min };
    lists.set(query, entry);
    return {
      get matches() {
        return matches(entry.min);
      },
      media: query,
      addEventListener: (_: string, l: Listener) => entry.listeners.add(l),
      removeEventListener: (_: string, l: Listener) => entry.listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    resize(next: number) {
      width = next;
      for (const e of lists.values()) for (const l of e.listeners) l();
    },
  };
}
