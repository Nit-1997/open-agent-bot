import type { ProductComparison as ProductComparisonData } from "@shared/widgets";
import { money } from "@/lib/format";
import { Card, ExternalLink } from "./Card";

const AVAILABILITY: Record<ProductComparisonData["rows"][number]["availability"], { label: string; cls: string }> = {
  in_stock: { label: "In stock", cls: "text-green-700 dark:text-green-400" },
  out_of_stock: { label: "Out of stock", cls: "text-red-700 dark:text-red-400" },
  unknown: { label: "Unknown", cls: "text-neutral-500" },
  blocked: { label: "Site blocked automated access — open link", cls: "text-amber-700 dark:text-amber-400" },
};

export function ProductComparison({ toolCallId, widget, locale }: { toolCallId: string; widget: ProductComparisonData; locale: string }) {
  const id = `product-comparison-${toolCallId}`;
  return (
    <Card id={id} title={widget.query} subtitle="Prices and stock as loaded just now">
      <ul id={`${id}-rows`} className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {widget.rows.map((r, i) => {
          const a = AVAILABILITY[r.availability];
          return (
            <li id={`${id}-row-${i}`} key={i} className="flex flex-col gap-0.5 py-2 text-sm">
              <div id={`${id}-row-${i}-head`} className="flex items-baseline justify-between gap-2">
                <ExternalLink id={`${id}-row-${i}-link`} href={r.url} className="font-medium text-blue-600 underline dark:text-blue-400">
                  {r.store}
                </ExternalLink>
                <span id={`${id}-row-${i}-price`} className="font-semibold">
                  {money(r.price, widget.currency, locale) ?? "—"}
                </span>
              </div>
              <span id={`${id}-row-${i}-title`} className="text-neutral-600 dark:text-neutral-300">
                {r.title}
              </span>
              <span id={`${id}-row-${i}-availability`} className={`text-xs ${a.cls}`}>
                {a.label}
              </span>
              {r.note && (
                <span id={`${id}-row-${i}-note`} className="text-xs text-neutral-500">
                  {r.note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
