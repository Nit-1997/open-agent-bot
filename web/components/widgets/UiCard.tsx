import type { UiBlock, UiWidget } from "@shared/widgets";
import { ExternalLink } from "./Card";

const UNVERIFIED_TITLE = "Not found in the sources I read";

const TONES = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
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
            className="rounded bg-amber-100 px-0.5 text-inherit underline decoration-amber-500 decoration-dotted after:ml-0.5 after:text-[10px] after:text-amber-600 after:content-['?'] dark:bg-amber-900/50"
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

function Block({ id, block, flags }: { id: string; block: UiBlock; flags: string[] }) {
  const m = (sid: string, text: string | undefined) => (text ? <Marked id={sid} text={text} flags={flags} /> : null);
  switch (block.type) {
    case "heading":
      return (
        <h4 id={id} className="mt-3 text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
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
            <div id={`${id}-${i}`} key={i} className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
              <dt id={`${id}-${i}-label`} className="text-xs text-neutral-500 dark:text-neutral-400">
                {m(`${id}-${i}-label`, s.label)}
              </dt>
              <dd id={`${id}-${i}-value`} className="text-lg font-semibold">
                {m(`${id}-${i}-value`, s.value)}
              </dd>
              {s.note && (
                <dd id={`${id}-${i}-note`} className="text-xs text-neutral-500 dark:text-neutral-400">
                  {m(`${id}-${i}-note`, s.note)}
                </dd>
              )}
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <div id={id} className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table id={`${id}-table`} className="w-full text-left text-sm">
            <thead id={`${id}-head`} className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <tr id={`${id}-head-row`}>
                {block.columns.map((c, i) => (
                  <th id={`${id}-h${i}`} key={i} scope="col" className="px-3 py-2 font-medium">
                    {m(`${id}-h${i}`, c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody id={`${id}-body`} className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {block.rows.map((r, ri) => (
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
      );
    case "list":
      return (
        <ul id={id} className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
          {block.items.map((it, i) => {
            const iid = `${id}-${i}`;
            return (
              <li id={iid} key={i} className="flex items-start justify-between gap-3 py-2">
                <div id={`${iid}-main`} className="min-w-0">
                  {it.url ? (
                    <ExternalLink id={`${iid}-title`} href={it.url} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {m(`${iid}-title`, it.title)}
                    </ExternalLink>
                  ) : (
                    <span id={`${iid}-title`} className="font-medium">
                      {m(`${iid}-title`, it.title)}
                    </span>
                  )}
                  {it.subtitle && (
                    <p id={`${iid}-subtitle`} className="text-xs text-neutral-500 dark:text-neutral-400">
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
                    <span id={`${iid}-badge`} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {m(`${iid}-badge`, it.badge)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      );
    case "checklist":
      return (
        <div id={id} className="mt-2">
          {block.title && (
            <p id={`${id}-title`} className="text-sm font-medium">
              {m(`${id}-title`, block.title)}
            </p>
          )}
          <ul id={`${id}-items`} className="mt-1 space-y-1">
            {block.items.map((it, i) => (
              <li id={`${id}-${i}`} key={i}>
                <label id={`${id}-${i}-label`} className="flex items-start gap-2 text-sm">
                  <input id={`${id}-${i}-check`} type="checkbox" className="mt-0.5 accent-indigo-600" />
                  <span id={`${id}-${i}-text`}>
                    {m(`${id}-${i}-text`, it.text)}
                    {it.note && (
                      <span id={`${id}-${i}-note`} className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {m(`${id}-${i}-note`, it.note)}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
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
              className="rounded-full bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
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
    <section id={id} className="my-2 w-full rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <header id={`${id}-header`}>
        <h3 id={`${id}-title`} className="text-base font-semibold">
          <Marked id={`${id}-title`} text={widget.title} flags={flags} />
        </h3>
        {widget.subtitle && (
          <p id={`${id}-subtitle`} className="text-xs text-neutral-500 dark:text-neutral-400">
            <Marked id={`${id}-subtitle`} text={widget.subtitle} flags={flags} />
          </p>
        )}
      </header>
      {widget.blocks.map((b, i) => (
        <Block key={i} id={`${id}-b${i}`} block={b} flags={flags} />
      ))}
      {(flags.length > 0 || removed > 0) && (
        <footer id={`${id}-grounding`} className="mt-3 border-t border-neutral-100 pt-2 text-xs text-amber-700 dark:border-neutral-800 dark:text-amber-400">
          {flags.length > 0 && (
            <p id={`${id}-grounding-unverified`}>Values marked with ? weren't found in the sources I read. Check the store before relying on them.</p>
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
