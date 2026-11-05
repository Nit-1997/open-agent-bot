"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GitHubIcon } from "@/components/brand/BrandIcons";
import { REPO_URL } from "@/lib/links";

export const SCROLLED_AT = 50;

const GLASS = {
  clear: "border-white/[0.12] bg-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
  navy: "border-white/[0.14] bg-[#14243D]/80 shadow-[0_8px_32px_rgba(8,12,28,0.35)]",
  frosted: "border-white/40 bg-white/70 shadow-[0_8px_32px_rgba(0,0,0,0.1)]",
};

export type SiteNavCta = "signin" | "none";
type Tone = "clear" | "navy";

function useScrolled(enabled: boolean): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setScrolled(window.scrollY > SCROLLED_AT);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [enabled]);
  return enabled && scrolled;
}

export function SiteNav({
  id,
  onHome = false,
  cta = "signin",
  tone = "clear",
}: {
  id: string;
  onHome?: boolean;
  cta?: SiteNavCta;
  tone?: Tone;
}) {
  const scrolled = useScrolled(onHome);
  const section = (hash: string) => (onHome ? `#${hash}` : `/#${hash}`);
  const link = `hidden whitespace-nowrap transition-colors duration-300 ${scrolled ? "text-[#111]/70 hover:text-[#111]" : "text-white/70 hover:text-white"}`;
  const size = scrolled ? "top-2 h-12 gap-3 sm:gap-5 pl-4 sm:pl-5" : "top-4 h-14 gap-3.5 sm:gap-7 pl-4 sm:pl-6";
  const right = cta === "none" ? (scrolled ? "pr-4 sm:pr-5" : "pr-4 sm:pr-6") : scrolled ? "pr-1.5" : "pr-2";

  return (
    <nav
      id={id}
      aria-label="Site"
      data-scrolled={scrolled ? "true" : "false"}
      className={`${onHome ? "fixed" : "absolute"} left-1/2 z-50 flex w-max -translate-x-1/2 items-center rounded-full border text-sm backdrop-blur-xl transition-all duration-500 ease-out ${size} ${right} ${GLASS[scrolled ? "frosted" : tone]}`}
    >
      <Link id={`${id}-logo`} href="/" aria-label="Open Agent home" className="flex shrink-0 items-center">
        <Image
          id={`${id}-logo-image`}
          src={scrolled ? "/brand/open-agent-logo-light.svg" : "/brand/open-agent-logo-dark.svg"}
          alt="Open Agent"
          width={137}
          height={26}
          priority
          className={`w-auto transition-all duration-500 ${scrolled ? "h-[19px] sm:h-[22px]" : "h-[20px] sm:h-[26px]"}`}
        />
      </Link>
      <a id={`${id}-how`} href={section("landing-demo")} className={`${link} sm:inline`}>
        How it works
      </a>
      <a id={`${id}-try`} href={section("landing-ways")} className={`${link} md:inline`}>
        Try it
      </a>
      <a
        id={`${id}-github`}
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Agent on GitHub"
        className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-300 ${scrolled ? "text-[#111]/70 hover:text-[#111]" : "text-white/70 hover:text-white"}`}
      >
        <GitHubIcon id={`${id}-github-icon`} className="h-4 w-4" />
        <span id={`${id}-github-text`} className="hidden sm:inline">
          GitHub
        </span>
      </a>
      {cta === "signin" && (
        <Link
          id={`${id}-signin`}
          href="/login"
          className={`inline-flex items-center rounded-full font-medium whitespace-nowrap transition-all duration-500 ${scrolled ? "h-[34px] px-4 text-[13px]" : "h-[38px] px-[18px] text-sm"} ${scrolled ? "bg-[#111] text-white hover:bg-[#111]/85" : "bg-white text-[#111] hover:bg-white/85"}`}
        >
          Sign in
        </Link>
      )}
    </nav>
  );
}
