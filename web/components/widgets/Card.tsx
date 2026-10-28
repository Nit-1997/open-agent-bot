export function Card(props: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={props.id} className="w-full rounded-2xl border border-border bg-paper p-4">
      <h3 id={`${props.id}-title`} className="text-[17px] font-medium text-text-primary">
        {props.title}
      </h3>
      {props.subtitle && (
        <p id={`${props.id}-subtitle`} className="text-xs text-text-muted">
          {props.subtitle}
        </p>
      )}
      {props.children}
    </section>
  );
}

export function ExternalLink(props: { id: string; href: string; className?: string; children: React.ReactNode }) {
  return (
    <a id={props.id} href={props.href} target="_blank" rel="noopener noreferrer" className={props.className ?? "text-cortex-600 underline"}>
      {props.children}
    </a>
  );
}
