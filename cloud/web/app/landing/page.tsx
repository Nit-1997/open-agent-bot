import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppleIcon, GitHubIcon } from "@/components/brand/BrandIcons";
import { LiveRun } from "@/components/landing/LiveRun";
import { TabletVideo } from "@/components/landing/TabletVideo";
import { REPO_URL } from "@/lib/links";
import { DESKTOP_URL } from "@/lib/usageCopy";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const GLASS = "border border-white/60 bg-white/55 shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-xl";
const LABEL = "font-mono text-[11px] uppercase tracking-[0.14em] text-[#888]";
const DARK_LABEL = "font-mono text-[11px] tracking-[0.14em] text-white/55 uppercase";

const DARK_GLASS = "border border-white/[0.12] bg-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl";
const LIGHT_PILL = "inline-flex items-center gap-2.5 rounded-full bg-white font-medium text-[#111] transition hover:bg-white/85";
const GHOST_PILL =
  "inline-flex items-center gap-2.5 rounded-full border border-white/35 font-medium text-white transition hover:bg-white/[0.08]";
const BIG = "h-[52px] px-[30px] text-base";
const MID = "h-[46px] px-[22px] text-[14.5px]";

const HERO_BACKGROUND =
  "linear-gradient(180deg, rgba(8,12,28,.35) 0%, rgba(8,12,28,.15) 45%, rgba(8,12,28,.45) 100%), url(/landing/night-sky.jpg) center / cover no-repeat, #1d2540";
const SHOWCASE_BACKGROUND = "linear-gradient(180deg, #C5D0F5 0%, #DAE2FA 40%, #EBF0FC 70%, #F2F4FC 100%)";

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

const REASONS = [
  { title: "See every step", body: "Searches, pages and tools, live." },
  { title: "Any model", body: "ChatGPT plan, API key, or local." },
  { title: "Your data", body: "Encrypted keys. Read-only browsing." },
  { title: "Your skills", body: "Teach it once. It remembers you.", soon: true },
];

const WAYS = [
  {
    key: "sandbox",
    label: "Hosted sandbox",
    title: "Try it in your browser",
    points: ["Sign in with Google, nothing to install", "Bring your own model or ChatGPT plan", "Fair-use limits on runs"],
  },
  {
    key: "mac",
    label: "Open source · MIT",
    title: "Run it on your Mac",
    points: ["Free download, runs with Docker", "Your chats and keys stay on your machine", "No limits, no account"],
  },
];

const MODELS = ["ChatGPT", "OpenAI", "Anthropic", "OpenRouter", "Ollama"];

function SourceLink({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  return (
    <a id={id} href={REPO_URL} {...EXTERNAL} className={className}>
      <GitHubIcon id={`${id}-icon`} />
      {children}
    </a>
  );
}

export default function LandingPage() {
  return (
    <div id="landing" className="min-h-dvh bg-[#FAF9F7] font-sans text-[#111]">
      <header
        id="landing-hero"
        className="relative flex min-h-dvh flex-col overflow-hidden text-white"
        style={{ background: HERO_BACKGROUND }}
      >
        <nav
          id="landing-nav"
          className={`absolute top-4 left-1/2 z-10 flex h-14 -translate-x-1/2 items-center gap-4 rounded-full pr-2 pl-5 text-sm sm:gap-7 sm:pl-6 ${DARK_GLASS}`}
        >
          <Link id="landing-nav-logo" href="/" className="font-display text-[22px] whitespace-nowrap">
            Open Agent
          </Link>
          <a id="landing-nav-how" href="#landing-demo" className="hidden whitespace-nowrap text-white/70 hover:text-white sm:inline">
            How it works
          </a>
          <a id="landing-nav-try" href="#landing-ways" className="hidden whitespace-nowrap text-white/70 hover:text-white md:inline">
            Try it
          </a>
          <a
            id="landing-nav-github"
            href={REPO_URL}
            {...EXTERNAL}
            aria-label="Open Agent on GitHub"
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-white/70 hover:text-white"
          >
            <GitHubIcon id="landing-nav-github-icon" className="h-4 w-4" />
            <span id="landing-nav-github-text" className="hidden sm:inline">
              GitHub
            </span>
          </a>
          <Link id="landing-nav-signin" href="/login" className={`${LIGHT_PILL} h-[38px] px-[18px] text-sm whitespace-nowrap`}>
            Sign in
          </Link>
        </nav>

        <div
          id="landing-hero-inner"
          className="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-14 px-6 pt-28 pb-24 text-center lg:grid-cols-[1fr_1fr] lg:px-12 lg:text-left"
        >
          <div id="landing-hero-copy" className="flex flex-col items-center lg:items-start">
            <p id="landing-hero-label" className={DARK_LABEL}>
              Open source · MIT
            </p>
            <h1
              id="landing-hero-title"
              className="mt-5 mb-6 max-w-[620px] font-display text-[46px] leading-[1.04] sm:text-[64px] lg:text-[76px]"
            >
              A personal agent you can <i id="landing-hero-title-em">see</i> think.
            </h1>
            <p id="landing-hero-body" className="mb-9 max-w-[480px] text-[17px] leading-relaxed text-white/75 sm:text-lg">
              Free and open source. Try the hosted sandbox in your browser, or run it on your own Mac.
            </p>
            <div id="landing-hero-actions" className="flex flex-wrap justify-center gap-3 lg:justify-start">
              <Link id="landing-hero-cta" href="/request-access" className={`${LIGHT_PILL} ${BIG}`}>
                Try the sandbox{" "}
                <span id="landing-hero-cta-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
              <SourceLink id="landing-hero-source" className={`${GHOST_PILL} ${BIG}`}>
                View source
              </SourceLink>
            </div>
          </div>
          <TabletVideo />
        </div>

        <div
          id="landing-hero-notch"
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 flex h-10 w-[320px] -translate-x-1/2 items-center justify-center rounded-t-[2rem] bg-[#FAF9F7] md:w-[400px]"
        >
          <span id="landing-hero-notch-bar" className="h-1 w-12 rounded-full bg-[#111]/15" />
        </div>
      </header>

      <section id="landing-demo" className="mx-auto max-w-[1040px] px-6 pt-20 text-center">
        <p id="landing-demo-label" className={LABEL}>
          Watch it work
        </p>
        <h2 id="landing-demo-title" className="mt-3 font-display text-[40px] leading-[1.1] sm:text-[48px]">
          Every source. Every claim.
        </h2>
        <div id="landing-demo-frame" className="mt-12 rounded-[28px] p-4 sm:p-10" style={{ background: SHOWCASE_BACKGROUND }}>
          <div id="landing-showcase" className={`mx-auto max-w-[880px] rounded-[24px] p-3 ${GLASS}`}>
            <LiveRun />
          </div>
        </div>
        <p id="landing-showcase-caption" className="mt-4 text-[13px] text-[#777]">
          Replayed from a real Open Agent run. Text lightly trimmed.
        </p>
      </section>

      <section
        id="landing-ways"
        className="mx-6 mt-24 overflow-hidden rounded-[28px] px-6 py-24 text-center text-white sm:py-28"
        style={{ background: HERO_BACKGROUND }}
      >
        <p id="landing-ways-label" className={DARK_LABEL}>
          Two ways to use it
        </p>
        <h2 id="landing-ways-title" className="mt-3 font-display text-[40px] leading-[1.1] sm:text-[56px]">
          Try it here. Keep it forever.
        </h2>
        <p id="landing-ways-body" className="mt-3.5 text-white/70">
          Same agent, same features. Pick where it runs.
        </p>
        <ul id="landing-ways-list" className="mx-auto mt-12 grid max-w-[900px] gap-4 text-left md:grid-cols-2">
          {WAYS.map((way) => (
            <li id={`landing-way-${way.key}`} key={way.key} className={`flex flex-col rounded-[24px] p-7 sm:p-8 ${DARK_GLASS}`}>
              <span id={`landing-way-${way.key}-label`} className={DARK_LABEL}>
                {way.label}
              </span>
              <h3 id={`landing-way-${way.key}-title`} className="mt-3 mb-3 font-display text-[32px] leading-[1.1] sm:text-[34px]">
                {way.title}
              </h3>
              <ul id={`landing-way-${way.key}-points`} className="mb-7 flex-1 space-y-1.5 text-[14.5px] text-white/80">
                {way.points.map((point, i) => (
                  <li id={`landing-way-${way.key}-point-${i}`} key={point}>
                    <span id={`landing-way-${way.key}-point-${i}-dash`} aria-hidden="true" className="mr-1.5 text-white/40">
                      —
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <div id={`landing-way-${way.key}-actions`} className="flex flex-wrap gap-2.5">
                {way.key === "sandbox" ? (
                  <Link id="landing-way-sandbox-cta" href="/request-access" className={`${LIGHT_PILL} ${MID}`}>
                    Try the sandbox{" "}
                    <span id="landing-way-sandbox-cta-arrow" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ) : (
                  <>
                    <a id="landing-way-mac-download" href={DESKTOP_URL} {...EXTERNAL} className={`${LIGHT_PILL} ${MID}`}>
                      <AppleIcon id="landing-way-mac-download-icon" />
                      Download for Mac
                    </a>
                    <SourceLink id="landing-way-mac-source" className={`${GHOST_PILL} ${MID}`}>
                      View source
                    </SourceLink>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p id="landing-ways-foot" className="mt-7 text-[13px] text-white/55">
          Apple silicon and Intel · Linux and Windows: run it with Docker Compose
        </p>
      </section>

      <section id="landing-why" className="mx-auto max-w-[960px] px-6 py-28 text-center">
        <p id="landing-why-label" className={LABEL}>
          Why
        </p>
        <h2 id="landing-why-title" className="mt-3 font-display text-[40px] leading-[1.1] sm:text-[48px]">
          No black box.
        </h2>
        <ul id="landing-why-list" className="mt-12 grid gap-3.5 text-left sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map((reason, i) => (
            <li id={`landing-why-${i}`} key={reason.title} className="rounded-2xl bg-[#F2F0ED] p-[22px] text-sm text-[#555]">
              <span id={`landing-why-${i}-number`} className={LABEL}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 id={`landing-why-${i}-title`} className="mt-2.5 mb-1 text-[17px] font-medium text-[#111]">
                {reason.title}{" "}
                {reason.soon && (
                  <span
                    id={`landing-why-${i}-soon`}
                    className="ml-1 rounded-full bg-[#6b5cc4]/10 px-2 py-[3px] align-middle font-mono text-[10px] tracking-[0.1em] text-[#6b5cc4] uppercase"
                  >
                    Soon
                  </span>
                )}
              </h3>
              <p id={`landing-why-${i}-body`}>{reason.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="landing-models" className="mx-auto max-w-[960px] px-6 pb-28 text-center">
        <p id="landing-models-label" className={LABEL}>
          Bring your own model
        </p>
        <ul id="landing-models-list" className="mt-6 flex flex-wrap justify-center gap-2.5">
          {MODELS.map((model) => (
            <li id={`landing-model-${model.toLowerCase()}`} key={model} className={`rounded-full px-4 py-2 text-sm text-[#444] ${GLASS}`}>
              {model}
            </li>
          ))}
        </ul>
      </section>

      <section
        id="landing-cta"
        className="mx-6 mb-6 overflow-hidden rounded-[28px] px-6 py-28 text-center text-white"
        style={{ background: HERO_BACKGROUND }}
      >
        <p id="landing-cta-label" className={DARK_LABEL}>
          Open source
        </p>
        <h2 id="landing-cta-title" className="mt-3 mb-2.5 font-display text-[44px] leading-[1.1] sm:text-[58px]">
          Get your own agent.
        </h2>
        <p id="landing-cta-body" className="mb-8 text-white/70">
          Try the sandbox now, or run it yourself for free.
        </p>
        <div id="landing-cta-actions" className="flex flex-wrap justify-center gap-3">
          <Link id="landing-cta-button" href="/request-access" className={`${LIGHT_PILL} ${BIG}`}>
            Try the sandbox{" "}
            <span id="landing-cta-button-arrow" aria-hidden="true">
              →
            </span>
          </Link>
          <SourceLink id="landing-cta-source" className={`${GHOST_PILL} ${BIG}`}>
            Star on GitHub
          </SourceLink>
        </div>
      </section>

      <footer id="landing-footer" className="mx-auto flex max-w-[960px] justify-between gap-4 px-6 pt-4 pb-10 text-[13px] text-[#888]">
        <span id="landing-footer-copy">© 2026 Open Agent · MIT licensed</span>
        <nav id="landing-footer-links" aria-label="Footer" className="flex flex-wrap items-center gap-5">
          <Link id="landing-footer-terms" href="/terms" className="hover:text-[#111]">
            Terms
          </Link>
          <Link id="landing-footer-privacy" href="/privacy" className="hover:text-[#111]">
            Privacy
          </Link>
          <a id="landing-footer-github" href={REPO_URL} {...EXTERNAL} className="inline-flex items-center gap-1.5 hover:text-[#111]">
            <GitHubIcon id="landing-footer-github-icon" className="h-[15px] w-[15px]" />
            GitHub
          </a>
          <Link id="landing-footer-signin" href="/login" className="hover:text-[#111]">
            Sign in
          </Link>
        </nav>
      </footer>
    </div>
  );
}
