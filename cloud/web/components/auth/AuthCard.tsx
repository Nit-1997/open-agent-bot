import type { ReactNode } from "react";
import { SiteNav, type SiteNavCta } from "@/components/site/SiteNav";

export function AuthCard({
  id,
  title,
  subtitle,
  nav = "signin",
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  nav?: SiteNavCta;
  children: ReactNode;
}) {
  return (
    <main id={id} className="relative flex min-h-dvh w-full items-center justify-center px-4 pt-24 pb-10">
      <SiteNav id={`${id}-nav`} cta={nav} tone="navy" />
      <section id={`${id}-card`} className="glass w-full max-w-[420px] space-y-5 rounded-[28px] p-6 sm:p-8">
        <header id={`${id}-header`} className="space-y-2">
          <span id={`${id}-orb`} aria-hidden="true" className="orb block h-8 w-8 shadow-float" />
          <h1 id={`${id}-title`} className="font-display text-[30px] leading-none text-text-primary">
            {title}
          </h1>
          {subtitle && (
            <p id={`${id}-subtitle`} className="text-sm text-text-muted">
              {subtitle}
            </p>
          )}
        </header>
        {children}
      </section>
    </main>
  );
}

export const authInput =
  "w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 text-[15px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300";
export const authPrimary =
  "w-full rounded-full bg-charcoal px-5 py-2.5 text-sm font-medium text-on-charcoal shadow-float transition hover:opacity-85 disabled:opacity-40";
export const authSecondary =
  "w-full rounded-full border border-border bg-paper px-5 py-2.5 text-sm font-medium text-text-primary transition hover:border-border-strong disabled:opacity-40";
