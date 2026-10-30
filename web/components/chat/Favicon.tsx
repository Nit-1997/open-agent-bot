"use client";

import { useState } from "react";
import { faviconUrl } from "@/lib/sources";

export function Favicon({ id, host, size = 18, className = "" }: { id: string; host: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const base = `inline-flex shrink-0 items-center justify-center rounded-full bg-paper ring-2 ring-bg ${className}`;
  if (failed) {
    return (
      <span
        id={id}
        aria-hidden="true"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        className={`${base} bg-surface-accent font-mono text-text-muted`}
      >
        {host.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      id={id}
      src={faviconUrl(host)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${base} object-contain p-[1px]`}
    />
  );
}
