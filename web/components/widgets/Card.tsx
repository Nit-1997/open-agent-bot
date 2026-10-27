export function Card(props: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section
      id={props.id}
      className="my-2 w-full rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h3 id={`${props.id}-title`} className="text-base font-semibold">
        {props.title}
      </h3>
      {props.subtitle && (
        <p id={`${props.id}-subtitle`} className="text-xs text-neutral-500">
          {props.subtitle}
        </p>
      )}
      {props.children}
    </section>
  );
}

export function ExternalLink(props: { id: string; href: string; className?: string; children: React.ReactNode }) {
  return (
    <a id={props.id} href={props.href} target="_blank" rel="noopener noreferrer" className={props.className ?? "text-blue-600 underline dark:text-blue-400"}>
      {props.children}
    </a>
  );
}
