import type { ShellBridge, ShellState } from "../shared/actions.ts";
import { type Block, type Button, type ScreenModel, screenModel } from "../shared/screenModel.ts";

declare global {
  interface Window {
    shell: ShellBridge;
  }
}

const byId = (id: string) => document.getElementById(id);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string, o: { cls?: string; text?: string } = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.id = id;
  if (o.cls) e.className = o.cls;
  if (o.text !== undefined) e.textContent = o.text;
  return e;
}

const inputs = new Map<string, string>();

function block(prefix: string, b: Block): HTMLElement {
  const id = `${prefix}-${b.key}`;
  switch (b.kind) {
    case "p":
      return el("p", id, { cls: b.tone ? `text ${b.tone}` : "text", text: b.text });
    case "pre":
      return el("pre", id, { cls: "log", text: b.text });
    case "list": {
      const ul = el("ul", id, { cls: "list" });
      for (const item of b.items) ul.append(el("li", `${id}-${item.key}`, { text: item.text }));
      return ul;
    }
    case "rows": {
      const dl = el("dl", id, { cls: "rows" });
      for (const r of b.rows) {
        dl.append(el("dt", `${id}-${r.key}-label`, { text: r.label }), el("dd", `${id}-${r.key}-value`, { text: r.value }));
      }
      return dl;
    }
    case "input": {
      const wrap = el("div", id, { cls: "field" });
      const label = el("label", `${id}-label`, { text: b.label });
      const input = el("input", `${id}-input`);
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      label.htmlFor = input.id;
      input.value = inputs.get(input.id) ?? "";
      input.addEventListener("input", () => {
        inputs.set(input.id, input.value);
        for (const btn of document.querySelectorAll<HTMLButtonElement>("button[data-needs]"))
          btn.disabled = input.value !== btn.dataset.needs;
      });
      wrap.append(label, input);
      return wrap;
    }
    case "steps": {
      const ol = el("ol", `${prefix}-steps`, { cls: "steps" });
      for (const s of b.steps) {
        const li = el("li", `${prefix}-${s.key}`, { cls: "step" });
        li.dataset.state = s.state;
        li.append(
          el("span", `${prefix}-${s.key}-mark`, { cls: "mark" }),
          el("span", `${prefix}-${s.key}-label`, { cls: "label", text: s.label }),
          el("span", `${prefix}-${s.key}-detail`, { cls: "detail", text: s.detail }),
        );
        li.querySelector(".mark")?.setAttribute("aria-hidden", "true");
        if (s.bar) {
          const bar = el("progress", `${prefix}-${s.key}-bar`, { cls: "bar" });
          bar.max = s.bar.max;
          bar.value = s.bar.value;
          li.append(bar);
        }
        ol.append(li);
      }
      return ol;
    }
  }
}

function button(prefix: string, b: Button): HTMLButtonElement {
  const e = el("button", `${prefix}-${b.key}`, { cls: b.tone ? `btn ${b.tone}` : "btn", text: b.label });
  e.type = "button";
  if (b.needsInput) {
    e.dataset.needs = b.needsInput;
    e.disabled = (inputs.get(`${prefix}-type-input`) ?? "") !== b.needsInput;
  }
  e.addEventListener("click", () => {
    e.disabled = true;
    void window.shell.act(b.action).finally(() => {
      if (!b.needsInput) e.disabled = false;
    });
  });
  return e;
}

function build(m: ScreenModel): HTMLElement {
  const section = el("section", m.id, { cls: "screen" });
  section.setAttribute("aria-labelledby", `${m.id}-title`);
  section.append(el("h1", `${m.id}-title`, { cls: "title", text: m.title }));
  if (m.badge) section.append(el("p", `${m.id}-badge`, { cls: "badge", text: m.badge }));
  for (const b of m.blocks) section.append(block(m.id, b));
  if (m.buttons.length > 0) {
    const row = el("div", `${m.id}-buttons`, { cls: "buttons" });
    for (const b of m.buttons) row.append(button(m.id, b));
    section.append(row);
  }
  return section;
}

let last = "";
function render(s: ShellState): void {
  const label = byId("test-mode-label");
  if (label) label.hidden = !s.test;
  const m = screenModel(s);
  const key = JSON.stringify(m);
  if (key === last) return;
  if (!last.includes(`"id":"${m.id}"`)) inputs.clear();
  last = key;
  const main = byId("shell-main");
  if (!main) return;
  main.replaceChildren(build(m));
  document.body.dataset.screen = m.id;
  document.body.dataset.phase = s.phase;
}

document.addEventListener("DOMContentLoaded", () => {
  window.shell.onState(render);
  void window.shell.getState().then(render);
});
