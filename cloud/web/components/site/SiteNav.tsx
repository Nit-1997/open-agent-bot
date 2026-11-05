import Image from "next/image";
import Link from "next/link";
import { GitHubIcon } from "@/components/brand/BrandIcons";
import { REPO_URL } from "@/lib/links";

const GLASS = {
  clear: "border border-white/[0.12] bg-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl",
  navy: "border border-white/[0.14] bg-[#14243D]/80 shadow-[0_8px_32px_rgba(8,12,28,0.35)] backdrop-blur-xl",
};
const LIGHT_PILL = "inline-flex items-center gap-2.5 rounded-full bg-white font-medium text-[#111] transition hover:bg-white/85";
const LINK = "hidden whitespace-nowrap text-white/70 hover:text-white";

export type SiteNavCta = "signin" | "none";

export function SiteNav({
  id,
  onHome = false,
  cta = "signin",
  tone = "clear",
}: {
  id: string;
  onHome?: boolean;
  cta?: SiteNavCta;
  tone?: keyof typeof GLASS;
}) {
  const section = (hash: string) => (onHome ? `#${hash}` : `/#${hash}`);
  return (
    <nav
      id={id}
      aria-label="Site"
      className={`absolute top-4 left-1/2 z-10 flex h-14 w-max -translate-x-1/2 items-center gap-3.5 rounded-full pl-4 text-sm text-white sm:gap-7 sm:pl-6 ${cta === "none" ? "pr-4 sm:pr-6" : "pr-2"} ${GLASS[tone]}`}
    >
      <Link id={`${id}-logo`} href="/" aria-label="Open Agent home" className="flex shrink-0 items-center">
        <Image
          id={`${id}-logo-image`}
          src="/brand/open-agent-logo-dark.svg"
          alt="Open Agent"
          width={137}
          height={26}
          priority
          className="h-[20px] w-auto sm:h-[26px]"
        />
      </Link>
      <a id={`${id}-how`} href={section("landing-demo")} className={`${LINK} sm:inline`}>
        How it works
      </a>
      <a id={`${id}-try`} href={section("landing-ways")} className={`${LINK} md:inline`}>
        Try it
      </a>
      <a
        id={`${id}-github`}
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Agent on GitHub"
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-white/70 hover:text-white"
      >
        <GitHubIcon id={`${id}-github-icon`} className="h-4 w-4" />
        <span id={`${id}-github-text`} className="hidden sm:inline">
          GitHub
        </span>
      </a>
      {cta === "signin" && (
        <Link id={`${id}-signin`} href="/login" className={`${LIGHT_PILL} h-[38px] px-[18px] text-sm whitespace-nowrap`}>
          Sign in
        </Link>
      )}
    </nav>
  );
}
