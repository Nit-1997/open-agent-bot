"use client";

import type { UiBlock } from "@shared/widgets";
import { useEffect, useRef, useState } from "react";

type Product = Extract<UiBlock, { type: "products" }>["items"][number];
type Mark = (id: string, text: string | undefined) => React.ReactNode;

function ProductImage({ id, item }: { id: string; item: Product }) {
  const [failed, setFailed] = useState(false);
  if (!item.image || failed) {
    return (
      <span id={id} aria-hidden="true" className="flex h-full w-full items-center justify-center font-serif text-4xl text-text-muted">
        {item.title.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      id={id}
      src={item.image}
      alt={item.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-contain p-2 mix-blend-multiply"
    />
  );
}

function ProductCard({ id, item, m }: { id: string; item: Product; m: Mark }) {
  const body = (
    <>
      <div id={`${id}-media`} className="relative aspect-square w-full overflow-hidden bg-white">
        <ProductImage id={`${id}-img`} item={item} />
        {item.badge && (
          <span id={`${id}-badge`} className="absolute left-2 top-2 rounded-full bg-charcoal px-2 py-0.5 text-[10px] font-semibold text-on-charcoal">
            {m(`${id}-badge`, item.badge)}
          </span>
        )}
      </div>
      <div id={`${id}-info`} className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        <span id={`${id}-title`} className="line-clamp-2 text-[13px] font-medium leading-snug text-text-primary">
          {m(`${id}-title`, item.title)}
        </span>
        {item.note && (
          <span id={`${id}-note`} className="line-clamp-1 text-xs text-text-muted">
            {m(`${id}-note`, item.note)}
          </span>
        )}
        <span id={`${id}-foot`} className="mt-auto flex items-baseline justify-between gap-2 pt-1">
          {item.price && (
            <span id={`${id}-price`} className="text-sm font-semibold text-text-primary">
              {m(`${id}-price`, item.price)}
            </span>
          )}
          {item.store && (
            <span id={`${id}-store`} className="truncate text-[11px] text-text-muted">
              {item.store}
            </span>
          )}
        </span>
      </div>
    </>
  );
  const cls = "flex h-full flex-col overflow-hidden rounded-xl border border-border bg-paper transition";
  return (
    <li id={id} className="w-44 shrink-0 snap-start">
      {item.url ? (
        <a id={`${id}-link`} href={item.url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:border-border-strong hover:shadow-sm`}>
          {body}
        </a>
      ) : (
        <div id={`${id}-box`} className={cls}>
          {body}
        </div>
      )}
    </li>
  );
}

export function ProductRow({ id, label, items, m }: { id: string; label: string; items: Product[]; m: Mark }) {
  const row = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(measure, [items.length]);

  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = "absolute top-[38%] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full glass-pill text-text-primary shadow-sm sm:flex";

  return (
    <div id={id} className="relative -mx-4 mt-2">
      <ul
        id={`${id}-row`}
        ref={row}
        aria-label={label}
        onScroll={measure}
        className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((it, i) => (
          <ProductCard key={i} id={`${id}-${i}`} item={it} m={m} />
        ))}
      </ul>
      {!edges.start && (
        <button id={`${id}-prev`} type="button" aria-label="Scroll left" onClick={() => scroll(-1)} className={`${arrow} left-2`}>
          ‹
        </button>
      )}
      {!edges.end && (
        <button id={`${id}-next`} type="button" aria-label="Scroll right" onClick={() => scroll(1)} className={`${arrow} right-2`}>
          ›
        </button>
      )}
    </div>
  );
}
