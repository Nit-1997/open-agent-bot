export function ExternalLink(props: { id: string; href: string; className?: string; children: React.ReactNode }) {
  return (
    <a id={props.id} href={props.href} target="_blank" rel="noopener noreferrer" className={props.className ?? "text-mist-600 underline"}>
      {props.children}
    </a>
  );
}
