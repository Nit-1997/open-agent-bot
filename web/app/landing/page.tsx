import type { Metadata } from "next";
import Link from "next/link";
import { LiveRun } from "@/components/landing/LiveRun";

export const metadata: Metadata = {
  title: "Open Agent · A personal agent you can see think",
  description: "Run a personal research agent on any model, and see every source it reads and every claim it checks. Private beta.",
};

const GLASS = "border border-white/60 bg-white/55 shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-xl";
const PILL_BUTTON = "inline-flex items-center gap-2.5 rounded-full bg-[#111] font-medium text-white transition hover:bg-[#111]/85";
const LABEL = "font-mono text-[11px] uppercase tracking-[0.14em] text-[#888]";

const HERO_BACKGROUND = [
  "radial-gradient(60% 45% at 20% 85%, rgba(120,150,230,.45), transparent 70%)",
  "radial-gradient(55% 40% at 85% 90%, rgba(150,215,190,.5), transparent 70%)",
  "radial-gradient(40% 30% at 50% 100%, rgba(255,255,255,.9), transparent 70%)",
  "linear-gradient(180deg, #F4F3F0 0%, #E9EEF8 55%, #DCE6F7 100%)",
].join(", ");

const REASONS = [
  { title: "See every step", body: "Searches, pages and tools, live." },
  { title: "Any model", body: "ChatGPT plan, API key, or local." },
  { title: "Your data", body: "Encrypted keys. Read-only browsing." },
  { title: "Your skills", body: "Teach it once. It remembers you.", soon: true },
];

const MODELS = ["ChatGPT", "OpenAI", "Anthropic", "OpenRouter", "Ollama"];

export default function LandingPage() {
  return (
    <div id="landing" className="min-h-dvh bg-[#FAF9F7] font-sans text-[#111]">
      <header id="landing-hero" className="relative overflow-hidden pb-24" style={{ background: HERO_BACKGROUND }}>
        <nav
          id="landing-nav"
          className={`absolute top-4 left-1/2 z-10 flex h-14 -translate-x-1/2 items-center gap-5 rounded-full pr-2 pl-6 text-sm sm:gap-7 ${GLASS}`}
        >
          <Link id="landing-nav-logo" href="/" className="font-display text-[22px] whitespace-nowrap">
            Open Agent
          </Link>
          <a id="landing-nav-how" href="#landing-why" className="hidden whitespace-nowrap text-[#555] hover:text-[#111] sm:inline">
            How it works
          </a>
          <Link id="landing-nav-signin" href="/login" className={`${PILL_BUTTON} h-[38px] px-[18px] text-sm`}>
            Sign in
          </Link>
        </nav>

        <div id="landing-hero-inner" className="flex flex-col items-center px-6 pt-40 text-center">
          <p id="landing-hero-label" className={LABEL}>
            Private beta
          </p>
          <h1
            id="landing-hero-title"
            className="mt-5 mb-9 max-w-[860px] font-display text-[46px] leading-[1.04] sm:text-[64px] md:text-[76px]"
          >
            A personal agent you can <i id="landing-hero-title-em">see</i> think.
          </h1>
          <Link id="landing-hero-cta" href="/request-access" className={`${PILL_BUTTON} h-[52px] px-[30px] text-base`}>
            Request beta access{" "}
            <span id="landing-hero-cta-arrow" aria-hidden="true">
              →
            </span>
          </Link>

          <div id="landing-showcase" className={`mt-16 w-full max-w-[880px] rounded-[28px] p-3.5 ${GLASS}`}>
            <LiveRun />
          </div>
          <p id="landing-showcase-caption" className="mt-4 text-[13px] text-[#777]">
            Replayed from a real Open Agent run. Text lightly trimmed.
          </p>
        </div>
      </header>

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
        className="mx-6 mb-6 rounded-[28px] px-6 py-28 text-center"
        style={{ background: "linear-gradient(180deg, #C5D0F5 0%, #DAE2FA 40%, #EBF0FC 70%, #F2F4FC 100%)" }}
      >
        <p id="landing-cta-label" className={LABEL}>
          Invite only
        </p>
        <h2 id="landing-cta-title" className="mt-3 mb-2.5 font-display text-[44px] leading-[1.1] sm:text-[58px]">
          Get your own agent.
        </h2>
        <p id="landing-cta-body" className="mb-8 text-[#555]">
          Tell us who you are. We&apos;ll send an invite.
        </p>
        <Link id="landing-cta-button" href="/request-access" className={`${PILL_BUTTON} h-[52px] px-[30px] text-base`}>
          Request beta access{" "}
          <span id="landing-cta-button-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </section>

      <footer id="landing-footer" className="mx-auto flex max-w-[960px] justify-between px-6 pt-4 pb-10 text-[13px] text-[#888]">
        <span id="landing-footer-copy">© 2026 Open Agent</span>
        <Link id="landing-footer-signin" href="/login" className="hover:text-[#111]">
          Sign in
        </Link>
      </footer>
    </div>
  );
}
