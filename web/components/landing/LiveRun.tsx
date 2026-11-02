"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Run = {
  question: string;
  steps: string[];
  sources: string;
  report: { title: string; image: string };
  answer: string[];
  followups: string[];
};

export const RUNS: Run[] = [
  {
    question: "Research the best indoor plants for low light and make me a one-page guide",
    steps: ["Ran research · read 2 sources", "Checked 32 claims · 30 supported · 2 removed", "Built report · one-page guide"],
    sources: "2 read · 32 claims checked",
    report: { title: "Best Low-Light Indoor Plants", image: "/landing/low-light-guide.jpg" },
    answer: [
      "Your one-page guide is ready. Two sources agreed that the safest low-light picks are ZZ plant, snake plant, pothos, heartleaf philodendron, peace lily, and a Chinese evergreen or dracaena.",
      "Low light still means some light, and overwatering is the main way these plants die. The research check removed 2 claims it couldn't support.",
    ],
    followups: ["Pet-safe low-light plants only", "Where to buy these plants", "Add a grow light guide"],
  },
  {
    question: "Pet-safe low-light plants only",
    steps: ["Ran research · read 4 sources", "Checked 31 claims · 26 supported · 3 removed · 2 flagged", "Built report · pet-safe guide"],
    sources: "4 read · 31 claims checked",
    report: { title: "Low-Light Houseplants Safe for Cats and Dogs", image: "/landing/pet-safe-guide.jpg" },
    answer: [
      "Two low-light plants are listed as non-toxic to cats and dogs by the ASPCA: parlor palm and cast iron plant.",
      "Skip with pets: pothos, philodendron, peace lily, Dieffenbachia, true lilies and snake plant. The research check removed 3 claims it couldn't confirm and flagged 2 more as unverified.",
    ],
    followups: [],
  },
];

type View = { run: number; typed: number; steps: number; running: boolean; answered: boolean; pressed: boolean };

const DONE: View = { run: 0, typed: RUNS[0].question.length, steps: 3, running: false, answered: true, pressed: false };
const START: View = { run: 0, typed: 0, steps: 0, running: false, answered: false, pressed: false };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LiveRun() {
  const [view, setView] = useState<View>(DONE);

  useEffect(() => {
    if (reducedMotion()) return;
    let alive = true;
    const set = (v: Partial<View>) => alive && setView((prev) => ({ ...prev, ...v }));

    async function play(run: number, typeIt: boolean) {
      set({ ...START, run, typed: typeIt ? 0 : RUNS[run].question.length });
      await wait(400);
      if (typeIt) {
        for (let i = 1; i <= RUNS[run].question.length && alive; i++) {
          set({ typed: i });
          await wait(28);
        }
      }
      await wait(500);
      for (let i = 1; i <= RUNS[run].steps.length && alive; i++) {
        set({ steps: i, running: true });
        await wait(1200);
      }
      set({ running: false, answered: true });
    }

    (async () => {
      await wait(1500);
      while (alive) {
        await play(0, true);
        await wait(3500);
        set({ pressed: true });
        await wait(700);
        await play(1, false);
        await wait(5000);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = RUNS[view.run];
  const shown = (on: boolean) => `transition duration-500 ${on ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`;

  return (
    <div
      id="landing-run"
      className="grid gap-6 rounded-[18px] bg-white/80 p-5 text-left text-sm text-[#222] sm:p-7 md:min-h-[360px] md:grid-cols-[1fr_240px]"
    >
      <div id="landing-run-chat">
        <p
          id="landing-run-question"
          className={`mb-4 ml-auto max-w-[85%] rounded-2xl bg-[#111] px-4 py-2.5 text-white ${shown(view.typed > 0)}`}
        >
          {run.question.slice(0, view.typed)}
        </p>
        <ol id="landing-run-steps" aria-label="Agent steps" className="space-y-1">
          {run.steps.map((step, i) => {
            const active = view.running && i === view.steps - 1;
            return (
              <li
                id={`landing-run-step-${i}`}
                key={step}
                className={`flex items-center gap-2.5 py-1 font-mono text-xs text-[#666] ${shown(i < view.steps)}`}
              >
                <span
                  id={`landing-run-step-${i}-dot`}
                  aria-hidden="true"
                  className={`h-[7px] w-[7px] rounded-full ${active ? "animate-pulse bg-[#e0a83f]" : "bg-[#3fbf7f]"}`}
                />
                <span id={`landing-run-step-${i}-text`}>{step}</span>
              </li>
            );
          })}
        </ol>
        <div id="landing-run-answer" className={`mt-4 space-y-3 leading-relaxed ${shown(view.answered)}`}>
          {run.answer.map((para, i) => (
            <p id={`landing-run-answer-${i}`} key={para}>
              {para}
            </p>
          ))}
          {run.followups.length > 0 && (
            <div id="landing-run-followups" className="flex flex-wrap gap-2 pt-1">
              {run.followups.map((reply, i) => (
                <span
                  id={`landing-run-followup-${i}`}
                  key={reply}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] transition duration-300 ${
                    view.pressed && i === 0 ? "scale-95 border-[#111] bg-[#111] text-white" : "border-black/15 text-[#333]"
                  }`}
                >
                  {reply}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <aside id="landing-run-meta" className="space-y-2">
        <div
          id="landing-run-sources"
          className={`rounded-xl bg-black/[0.04] px-3 py-2.5 text-[13px] text-[#555] ${shown(view.steps >= 2)}`}
        >
          <b id="landing-run-sources-label" className="block font-medium text-[#111]">
            Sources
          </b>
          {run.sources}
        </div>
        <div id="landing-run-report" className={`rounded-xl bg-black/[0.04] px-3 py-2.5 text-[13px] text-[#555] ${shown(view.answered)}`}>
          <b id="landing-run-report-label" className="block font-medium text-[#111]">
            Report
          </b>
          <Image
            id="landing-run-report-image"
            src={run.report.image}
            alt={`Report preview: ${run.report.title}`}
            width={1200}
            height={480}
            className="my-2 block h-auto w-full rounded-md border border-black/10"
          />
          <span id="landing-run-report-title" className="text-xs">
            {run.report.title}
          </span>
        </div>
      </aside>
    </div>
  );
}
