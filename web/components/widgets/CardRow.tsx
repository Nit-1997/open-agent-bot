"use client";

import type { UiBlock } from "@shared/widgets";
import { useEffect, useRef, useState } from "react";

type CardsBlock = Extract<UiBlock, { type: "cards" }>;
type CardItem = CardsBlock["items"][number];
type Mark = (id: string, text: string | undefined) => React.ReactNode;

export const mapUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

export function Picture({ id, src, alt, fallback, className }: { id: string; src?: string; alt: string; fallback: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span id={id} aria-hidden="true" className="flex h-full w-full items-center justify-center font-serif text-4xl text-text-muted">
        {fallback.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img id={id} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={className} />
  );
}

function Card({ id, item, wide, m }: { id: string; item: CardItem; wide: boolean; m: Mark }) {
  const head = (
    <>
      <div id={`${id}-media`} className={`relative w-full overflow-hidden ${wide ? "aspect-[16/10] bg-surface" : "aspect-square bg-white"}`}>
        <Picture
          id={`${id}-img`}
          src={item.image}
          alt={item.title}
          fallback={item.title}
          className={wide ? "h-full w-full object-cover" : "h-full w-full object-contain p-2 mix-blend-multiply"}
        />
        {item.badge && (
          <span id={`${id}-badge`} className="absolute left-2 top-2 rounded-full bg-charcoal px-2 py-0.5 text-[10px] font-semibold text-on-charcoal">
            {m(`${id}-badge`, item.badge)}
          </span>
        )}
      </div>
      <span id={`${id}-text`} className="flex flex-col gap-0.5 px-3 pt-2">
        <span id={`${id}-title`} className="line-clamp-2 text-[13px] font-medium leading-snug text-text-primary">
          {m(`${id}-title`, item.title)}
        </span>
        {item.subtitle && (
          <span id={`${id}-subtitle`} className="line-clamp-1 text-xs text-text-secondary">
            {m(`${id}-subtitle`, item.subtitle)}
          </span>
        )}
        {item.note && (
          <span id={`${id}-note`} className="line-clamp-1 text-xs text-text-muted">
            {m(`${id}-note`, item.note)}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li id={id} className={`${wide ? "w-64" : "w-44"} shrink-0 snap-start`}>
      <div id={`${id}-card`} className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-paper transition hover:border-border-strong hover:shadow-sm">
        {item.url ? (
          <a id={`${id}-link`} href={item.url} target="_blank" rel="noopener noreferrer" className="flex flex-col">
            {head}
          </a>
        ) : (
          head
        )}
        <span id={`${id}-foot`} className="mt-auto flex items-center gap-2 px-3 pb-2 pt-1.5 text-[11px] text-text-muted">
          {item.price && (
            <span id={`${id}-price`} className="text-sm font-semibold text-text-primary">
              {m(`${id}-price`, item.price)}
            </span>
          )}
          {item.rating && (
            <span id={`${id}-rating`} className="font-medium text-text-secondary">
              {m(`${id}-rating`, `★ ${item.rating}`)}
            </span>
          )}
          <span id={`${id}-spacer`} className="flex-1" />
          {item.source && (
            <span id={`${id}-source`} className="truncate">
              {item.source}
            </span>
          )}
          {item.place && (
            <a id={`${id}-map`} href={mapUrl(item.place)} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium text-mist-600 hover:underline">
              Map
            </a>
          )}
        </span>
      </div>
    </li>
  );
}

export function CardRow({ id, label, block, m }: { id: string; label: string; block: CardsBlock; m: Mark }) {
  const row = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const wide = block.shape === "wide";

  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(measure, [block.items.length]);

  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = `absolute ${wide ? "top-[30%]" : "top-[38%]"} hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full glass-pill text-text-primary shadow-sm sm:flex`;

  return (
    <div id={id} className="relative -mx-4 mt-2">
      <ul
        id={`${id}-row`}
        ref={row}
        aria-label={label}
        onScroll={measure}
        className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {block.items.map((it, i) => (
          <Card key={i} id={`${id}-${i}`} item={it} wide={wide} m={m} />
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

export function ImageBlock({ id, block, m }: { id: string; block: Extract<UiBlock, { type: "image" }>; m: Mark }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure id={id} className="mt-2 overflow-hidden rounded-xl border border-border bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        id={`${id}-img`}
        src={block.url}
        alt={block.caption ?? ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="max-h-72 w-full object-cover"
      />
      {(block.caption || block.source) && (
        <figcaption id={`${id}-caption`} className="flex items-baseline gap-2 px-3 py-1.5 text-xs text-text-muted">
          <span id={`${id}-caption-text`} className="flex-1">
            {m(`${id}-caption-text`, block.caption)}
          </span>
          {block.source && <span id={`${id}-source`}>{block.source}</span>}
        </figcaption>
      )}
    </figure>
  );
}
