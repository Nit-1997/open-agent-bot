import type { LucideIcon } from "lucide-react";
import { Link } from "@oab/ui/platform";
import type { MouseEventHandler, ReactNode } from "react";

export const RAIL_ITEM =
  "relative flex h-11 w-11 items-center justify-center rounded-[14px] text-text-muted transition hover:bg-surface hover:text-text-primary";
const ACTIVE = "bg-paper text-text-primary hover:bg-paper";

export function RailTooltip({ id, label }: { id: string; label: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-charcoal px-2 py-1 text-[12px] font-medium text-on-charcoal shadow-float group-hover:block group-focus-within:block"
    >
      {label}
    </span>
  );
}

export function RailLink(props: {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  badge?: ReactNode;
}) {
  const { id, icon: Icon } = props;
  return (
    <div id={`${id}-wrap`} className="group relative">
      <Link
        id={id}
        href={props.href}
        aria-label={props.label}
        aria-describedby={`${id}-tip`}
        aria-current={props.active ? "page" : undefined}
        onClick={props.onClick}
        className={`${RAIL_ITEM} ${props.active ? ACTIVE : ""}`}
      >
        <Icon id={`${id}-icon`} aria-hidden="true" size={20} strokeWidth={1.8} />
        {props.badge}
      </Link>
      <RailTooltip id={`${id}-tip`} label={props.label} />
    </div>
  );
}

export function RailButton(props: {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
}) {
  const { id, icon: Icon } = props;
  return (
    <div id={`${id}-wrap`} className="group relative">
      <button
        id={id}
        type="button"
        aria-label={props.label}
        aria-describedby={`${id}-tip`}
        aria-expanded={props.expanded}
        aria-controls={props.controls}
        onClick={props.onClick}
        className={RAIL_ITEM}
      >
        <Icon id={`${id}-icon`} aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>
      <RailTooltip id={`${id}-tip`} label={props.label} />
    </div>
  );
}
