import Link from "next/link";
import type { LegalBlock, LegalDoc } from "@/lib/legal";

const OTHER = {
  terms: { href: "/privacy", label: "Privacy Policy" },
  privacy: { href: "/terms", label: "Terms of Service" },
} as const;

function Block({ id, block }: { id: string; block: LegalBlock }) {
  switch (block.kind) {
    case "h2":
      return (
        <h2 id={id} className="pt-4 font-display text-[22px] leading-tight text-text-primary">
          {block.text}
        </h2>
      );
    case "h3":
      return (
        <h3 id={id} className="pt-2 text-[15px] font-semibold text-text-primary">
          {block.text}
        </h3>
      );
    case "p":
      return (
        <p id={id} className="text-[15px] leading-relaxed text-text-secondary">
          {block.text}
        </p>
      );
    case "ul":
      return (
        <ul id={id} className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-text-secondary">
          {block.items.map((text, i) => (
            <li id={`${id}-item-${i + 1}`} key={`${i}-${text}`}>
              {text}
            </li>
          ))}
        </ul>
      );
  }
}

export function LegalPage({ id, doc }: { id: keyof typeof OTHER; doc: LegalDoc }) {
  const other = OTHER[id];
  return (
    <main id={id} className="min-h-dvh w-full px-4 py-10">
      <article id={`${id}-card`} className="glass mx-auto w-full max-w-[720px] space-y-4 rounded-[28px] p-6 sm:p-10">
        <nav id={`${id}-nav`} aria-label="Legal" className="flex justify-between text-[13px] text-text-muted">
          <Link id={`${id}-home`} href="/" className="underline-offset-2 hover:underline">
            Open Agent
          </Link>
          <Link id={`${id}-other`} href={other.href} className="underline-offset-2 hover:underline">
            {other.label}
          </Link>
        </nav>
        {doc.draft && (
          <p id="legal-draft-banner" role="note" className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-sm text-warn-fg">
            Draft, not reviewed yet. This text is a placeholder until the owner replaces or approves it.
          </p>
        )}
        <h1 id={`${id}-title`} className="font-display text-[34px] leading-none text-text-primary">
          {doc.title}
        </h1>
        {doc.blocks.map((block, i) => (
          <Block key={`${block.kind}-${i}`} id={`${id}-block-${i + 1}`} block={block} />
        ))}
      </article>
    </main>
  );
}
