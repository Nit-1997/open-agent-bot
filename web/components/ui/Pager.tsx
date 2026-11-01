import { pageCount, rangeText } from "@/lib/pagination";

const button =
  "rounded-full border border-border px-3 py-1 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary disabled:opacity-40";

export function Pager(props: {
  id: string;
  page: number;
  pageSize: number;
  total: number;
  busy?: boolean;
  onPage: (page: number) => void;
}) {
  const { id, page, pageSize, total, busy } = props;
  const last = pageCount(pageSize, total);
  return (
    <nav id={id} aria-label="Pages" className="flex items-center justify-between gap-2 pt-2">
      <p id={`${id}-range`} className="text-[12px] text-text-muted">
        {rangeText(page, pageSize, total)}
      </p>
      <div id={`${id}-buttons`} className="flex gap-1.5">
        <button id={`${id}-prev`} type="button" disabled={busy || page <= 1} onClick={() => props.onPage(page - 1)} className={button}>
          Previous
        </button>
        <button id={`${id}-next`} type="button" disabled={busy || page >= last} onClick={() => props.onPage(page + 1)} className={button}>
          Next
        </button>
      </div>
    </nav>
  );
}
