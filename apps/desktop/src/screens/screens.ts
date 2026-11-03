import type { ShellBridge, ShellState } from "../shared/actions.ts";

declare global {
  interface Window {
    shell: ShellBridge;
  }
}

const STEPS = ["docker", "download", "start"] as const;
const PHASE_STEP: Readonly<Record<string, number>> = {
  checkingDocker: 0,
  inspecting: 0,
  pulling: 1,
  creating: 2,
  waitingHealth: 2,
  attaching: 2,
  resuming: 2,
  ready: 3,
};

const byId = (id: string) => document.getElementById(id);

function render(s: ShellState): void {
  const label = byId("test-mode-label");
  if (label) label.hidden = !s.test;
  const sections = document.querySelectorAll<HTMLElement>("section.screen");
  const target = [...sections].some((el) => el.id === s.screen) ? s.screen : "screen-progress";
  for (const el of sections) el.hidden = el.id !== target;
  const current = PHASE_STEP[s.phase] ?? 0;
  STEPS.forEach((step, i) => {
    const el = byId(`screen-progress-${step}`);
    if (el) el.dataset.state = i < current ? "done" : i === current ? "active" : "pending";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  window.shell.onState(render);
  void window.shell.getState().then(render);
});
