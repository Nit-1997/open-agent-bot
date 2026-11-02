import { safeHttpUrl } from "@shared/workspace";

export function ExternalLink(props: { id: string; href: string | undefined; className?: string; children: React.ReactNode }) {
  const href = safeHttpUrl(props.href);
  const className = props.className ?? "text-mist-600 underline";
  if (!href)
    return (
      <span id={props.id} className={className}>
        {props.children}
      </span>
    );
  return (
    <a id={props.id} href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {props.children}
    </a>
  );
}
