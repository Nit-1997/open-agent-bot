"use client";

export function Followups({ id, replies, onPick }: { id: string; replies: string[]; onPick: (text: string) => void }) {
  return (
    <div id={id} className="mt-3 flex flex-wrap gap-2">
      {replies.map((r, i) => (
        <button
          id={`${id}-${i}`}
          key={i}
          type="button"
          onClick={() => onPick(r)}
          className="rounded-full border border-border bg-paper px-3 py-1.5 text-[13px] text-text-secondary transition hover:border-border-strong hover:text-text-primary"
        >
          {r}
        </button>
      ))}
    </div>
  );
}
