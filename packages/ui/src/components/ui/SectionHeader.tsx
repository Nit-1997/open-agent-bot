"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useBreakpoint } from "../../lib/shell/breakpoints.ts";

export function SectionHeader(props: {
  id: string;
  title: string;
  count?: string;
  actions?: ReactNode;
  back?: ReactNode;
  focusOnMount?: boolean;
}) {
  const { id } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const phone = useBreakpoint() === "phone";
  useEffect(() => {
    if (props.focusOnMount !== false) heading.current?.focus({ preventScroll: true });
  }, [props.focusOnMount]);
  return (
    <header id={id} className="flex flex-col gap-2 pb-5 pt-2 sm:pt-6">
      {props.back}
      <div id={`${id}-row`} className="flex flex-wrap items-end justify-between gap-3">
        <div id={`${id}-titles`} className="min-w-0">
          <h1
            id={`${id}-title`}
            ref={heading}
            tabIndex={-1}
            className={phone ? "sr-only" : "truncate font-display text-[34px] leading-[1.1] text-text-primary outline-none"}
          >
            {props.title}
          </h1>
          {props.count && (
            <p id={`${id}-count`} className="mt-1 text-[13px] text-text-muted">
              {props.count}
            </p>
          )}
        </div>
        {props.actions && (
          <div id={`${id}-actions`} className="flex shrink-0 flex-wrap items-center gap-2">
            {props.actions}
          </div>
        )}
      </div>
    </header>
  );
}
