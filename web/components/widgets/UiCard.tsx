"use client";

import type { UiBlock, UiWidget } from "@shared/widgets";
import { useState } from "react";
import { ExternalLink } from "./ExternalLink";
import { CardRow, ImageBlock } from "./CardRow";

const VISIBLE_ITEMS = 5;

function Collapsible<T>({ id, items, children }: { id: string; items: T[]; children: (visible: T[]) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const hidden = items.length - VISIBLE_ITEMS;
  return (
    <>
      {children(open || hidden <= 0 ? items : items.slice(0, VISIBLE_ITEMS))}
      {hidden > 0 && (
        <button
          id={`${id}-more`}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-[13px] font-medium text-text-secondary underline-offset-4 transition hover:text-text-primary hover:underline"
        >
          {open ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}

const UNVERIFIED_TITLE = "Not found in the sources I read";

const TONES = {
  info: "border-transparent bg-info-bg text-info-fg",
  warning: "border-transparent bg-warn-bg text-warn-fg",
  success: "border-transparent bg-success-bg text-success-fg",
} as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Marked({ id, text, flags }: { id: string; text: string; flags: string[] }) {
  if (!flags.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${flags.map(escape).join("|")})`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        flags.includes(p) ? (
          <mark
            id={`${id}-u${i}`}
            key={i}
            title={UNVERIFIED_TITLE}
            className="rounded bg-warn-bg px-0.5 text-inherit underline decoration-warn-fg decoration-dotted after:ml-0.5 after:text-[10px] after:text-warn-fg after:content-['?']"
          >
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Block({ id, block, flags, label }: { id: string; block: UiBlock; flags: string[]; label: string }) {
  const m = (sid: string, text: string | undefined) => (text ? <Marked id={sid} text={text} flags={flags} /> : null);
  switch (block.type) {
    case "heading":
      return (
        <h4 id={id} className="mt-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
          {m(id, block.text)}
        </h4>
      );
    case "text":
      return (
        <p id={id} className="mt-2 whitespace-pre-line text-sm leading-relaxed">
          {m(id, block.text)}
        </p>
      );
    case "stats":
      return (
        <dl id={id} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {block.items.map((s, i) => (
            <div id={`${id}-${i}`} key={i} className="rounded-lg bg-surface px-3 py-2">
              <dt id={`${id}-${i}-label`} className="text-xs text-text-muted">
                {m(`${id}-${i}-label`, s.label)}
              </dt>
              <dd id={`${id}-${i}-value`} className="text-lg font-semibold">
                {m(`${id}-${i}-value`, s.value)}
              </dd>
              {s.note && (
                <dd id={`${id}-${i}-note`} className="text-xs text-text-muted">
                  {m(`${id}-${i}-note`, s.note)}
                </dd>
              )}
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <div id={id} className="mt-2">
          <Collapsible id={id} items={block.rows}>
            {(rows) => (
              <div id={`${id}-scroll`} className="overflow-x-auto rounded-lg border border-border">
                <table id={`${id}-table`} className="w-full text-left text-sm">
                  <thead id={`${id}-head`} className="bg-surface text-xs text-text-muted">
                    <tr id={`${id}-head-row`}>
                      {block.columns.map((c, i) => (
                        <th id={`${id}-h${i}`} key={i} scope="col" className="px-3 py-2 font-medium">
                          {m(`${id}-h${i}`, c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody id={`${id}-body`} className="divide-y divide-border">
                    {rows.map((r, ri) => (
                      <tr id={`${id}-r${ri}`} key={ri}>
                        {r.map((cell, ci) => (
                          <td id={`${id}-r${ri}c${ci}`} key={ci} className="px-3 py-2">
                            {m(`${id}-r${ri}c${ci}`, cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Collapsible>
        </div>
      );
    case "list":
      return (
        <div id={id} className="mt-2">
          <Collapsible id={id} items={block.items}>
            {(items) => (
              <ul id={`${id}-items`} className="divide-y divide-border">
                {items.map((it, i) => {
                  const iid = `${id}-${i}`;
                  return (
                    <li id={iid} key={i} className="flex items-start justify-between gap-3 py-2">
                      <div id={`${iid}-main`} className="min-w-0">
                        {it.url ? (
                          <ExternalLink id={`${iid}-title`} href={it.url} className="font-medium text-mist-600 hover:underline">
                            {m(`${iid}-title`, it.title)}
                          </ExternalLink>
                        ) : (
                          <span id={`${iid}-title`} className="font-medium">
                            {m(`${iid}-title`, it.title)}
                          </span>
                        )}
                        {it.subtitle && (
                          <p id={`${iid}-subtitle`} className="line-clamp-2 text-xs text-text-muted">
                            {m(`${iid}-subtitle`, it.subtitle)}
                          </p>
                        )}
                      </div>
                      <div id={`${iid}-side`} className="flex shrink-0 flex-col items-end gap-1">
                        {it.value && (
                          <span id={`${iid}-value`} className="text-sm font-semibold">
                            {m(`${iid}-value`, it.value)}
                          </span>
                        )}
                        {it.badge && (
                          <span id={`${iid}-badge`} className="rounded-full bg-surface px-2 py-0.5 text-[11px] sm:text-[10px] font-semibold text-text-secondary">
                            {m(`${iid}-badge`, it.badge)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Collapsible>
        </div>
      );
    case "cards":
      return <CardRow id={id} label={label} block={block} m={m} />;
    case "image":
      return <ImageBlock id={id} block={block} m={m} />;
    case "checklist":
      return (
        <div id={id} className="mt-2">
          {block.title && (
            <p id={`${id}-title`} className="text-sm font-medium">
              {m(`${id}-title`, block.title)}
            </p>
          )}
          <Collapsible id={id} items={block.items}>
            {(items) => (
                <ul id={`${id}-items`} className="mt-1 space-y-1">
                  {items.map((it, i) => (
                    <li id={`${id}-${i}`} key={i}>
                      <label id={`${id}-${i}-label`} className="flex items-start gap-2 text-sm">
                        <input id={`${id}-${i}-check`} type="checkbox" className="mt-0.5 accent-mist-500" />
                        <span id={`${id}-${i}-text`}>
                          {m(`${id}-${i}-text`, it.text)}
                          {it.note && (
                            <span id={`${id}-${i}-note`} className="ml-1 text-xs text-text-muted">
                              {m(`${id}-${i}-note`, it.note)}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
            )}
          </Collapsible>
        </div>
      );
    case "links":
      return (
        <div id={id} className="mt-3 flex flex-wrap gap-2">
          {block.items.map((l, i) => (
            <ExternalLink
              id={`${id}-${i}`}
              key={i}
              href={l.url}
              className="rounded-full bg-charcoal px-3 py-1 text-sm font-medium text-on-charcoal hover:opacity-85"
            >
              {l.label}
            </ExternalLink>
          ))}
        </div>
      );
    case "callout":
      return (
        <p id={id} className={`mt-2 rounded-lg border px-3 py-2 text-sm ${TONES[block.tone]}`}>
          {m(id, block.text)}
        </p>
      );
  }
}

export function UiCard({ toolCallId, widget }: { toolCallId: string; widget: UiWidget }) {
  const id = `ui-${toolCallId}`;
  const flags = widget.unverified ?? [];
  const removed = widget.removedLinks ?? 0;
  return (
    <section id={id} className="my-2 w-full rounded-2xl border border-border bg-paper p-3 sm:p-4">
      <header id={`${id}-header`}>
        <h3 id={`${id}-title`} className="text-base font-semibold">
          <Marked id={`${id}-title`} text={widget.title} flags={flags} />
        </h3>
        {widget.subtitle && (
          <p id={`${id}-subtitle`} className="text-xs text-text-muted">
            <Marked id={`${id}-subtitle`} text={widget.subtitle} flags={flags} />
          </p>
        )}
      </header>
      {widget.blocks.map((b, i) => (
        <Block key={i} id={`${id}-b${i}`} block={b} flags={flags} label={widget.title} />
      ))}
      {(flags.length > 0 || removed > 0) && (
        <footer id={`${id}-grounding`} className="mt-3 border-t border-border pt-2 text-xs text-warn-fg">
          {flags.length > 0 && (
            <p id={`${id}-grounding-unverified`}>Values marked with ? weren&apos;t found in the sources I read. Check the store before relying on them.</p>
          )}
          {removed > 0 && (
            <p id={`${id}-grounding-links`}>
              {removed === 1 ? "1 link that didn't come from a source was removed." : `${removed} links that didn't come from a source were removed.`}
            </p>
          )}
        </footer>
      )}
    </section>
  );
}
