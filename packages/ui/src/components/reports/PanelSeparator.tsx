"use client";

import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { clampFraction, DEFAULT_PANEL_FRACTION, fractionLimits, SEPARATOR_PX, type SeparatorKey, step } from "@/lib/shell/panelWidth";

const KEYS: ReadonlySet<string> = new Set<SeparatorKey>(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function PanelSeparator(props: {
  id: string;
  panelId: string;
  fraction: number;
  available: number;
  onChange: (fraction: number, commit: boolean) => void;
}) {
  const { id, available, onChange } = props;
  const limits = fractionLimits(available);
  const value = clampFraction(props.fraction, limits);
  const percent = Math.round(value * 100);
  const drag = useRef<{ last: number; undo: () => void } | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!KEYS.has(e.key)) return;
    e.preventDefault();
    onChange(step(value, e.key as SeparatorKey, e.shiftKey, limits), true);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const pane = e.currentTarget.parentElement;
    if (!pane || !(available > 0)) return value;
    const right = pane.getBoundingClientRect().right;
    return clampFraction((right - e.clientX - SEPARATOR_PX / 2) / available, limits);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const frames = [...(e.currentTarget.parentElement?.querySelectorAll("iframe") ?? [])];
    for (const f of frames) f.style.pointerEvents = "none";
    const body = document.body.style;
    const before = { userSelect: body.userSelect, cursor: body.cursor };
    body.userSelect = "none";
    body.cursor = "col-resize";
    drag.current = {
      last: value,
      undo: () => {
        for (const f of frames) f.style.pointerEvents = "";
        body.userSelect = before.userSelect;
        body.cursor = before.cursor;
      },
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.last = fromPointer(e);
    onChange(drag.current.last, false);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.undo();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onChange(d.last, true);
  };

  return (
    <div
      id={id}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize report panel"
      aria-controls={props.panelId}
      aria-valuenow={percent}
      aria-valuemin={Math.round(limits.min * 100)}
      aria-valuemax={Math.round(limits.max * 100)}
      aria-valuetext={`Report panel, ${percent} percent`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(DEFAULT_PANEL_FRACTION, true)}
      className="group relative flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span id={`${id}-rule`} aria-hidden="true" className="absolute inset-y-0 left-[5px] w-px bg-surface-accent" />
      <span
        id={`${id}-grip`}
        aria-hidden="true"
        className="relative h-11 w-1.5 rounded-[3px] bg-border transition group-hover:bg-border-strong group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-mist-500"
      />
    </div>
  );
}
