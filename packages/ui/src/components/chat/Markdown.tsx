import type { ComponentProps, ElementType } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const TAGS = [
  "p",
  "a",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
] as const;

type Props = ComponentProps<"p"> & { node?: { position?: { start: { offset?: number } } } };

function components(prefix: string): Components {
  return Object.fromEntries(
    TAGS.map((tag) => [
      tag,
      ({ node, ...props }: Props) => {
        const id = `${prefix}-${tag}-${node?.position?.start.offset ?? 0}`;
        const Tag = tag as ElementType;
        if (tag === "a") return <a id={id} {...(props as ComponentProps<"a">)} target="_blank" rel="noopener noreferrer" />;
        return <Tag id={id} {...props} />;
      },
    ]),
  ) as Components;
}

export function Markdown({ id, text }: { id: string; text: string }) {
  return (
    <div id={id} className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} components={components(id)}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
