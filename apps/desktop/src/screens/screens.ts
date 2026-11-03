import type { ActResult, ShellAction, ShellBridge, ShellState } from "../shared/actions.ts";
import { filterLogs, LOG_SERVICES, type LogsView } from "../shared/logsFilter.ts";
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
type Ui = { confirm?: string; portPending?: number; portError?: string; logs: LogsView };
const freshUi = (): Ui => ({ logs: { service: "all", requestsOnly: false } });
let ui: Ui = freshUi();
let lastState: ShellState | undefined;

const rerender = () => {
  last = "";
  if (lastState) render(lastState);
};

const act = (action: ShellAction): Promise<ActResult> => window.shell.act(action);

const PORT_ERRORS: Readonly<Record<string, string>> = {
  invalid_port: "That port is taken or not allowed.",
  busy: "Open Agent is busy; try again in a moment.",
  invalid_action: "Use a port from 1024 to 65535.",
};

function table(id: string, b: Extract<Block, { kind: "table" }>): HTMLElement {
  const t = el("table", id, { cls: "table" });
  const head = el("thead", `${id}-head`);
  const headRow = el("tr", `${id}-head-row`);
  for (const c of b.columns) headRow.append(el("th", `${id}-head-${c.key}`, { text: c.label }));
  head.append(headRow);
  const body = el("tbody", `${id}-body`);
  for (const r of b.rows) {
    const tr = el("tr", `${id}-${r.key}`);
    for (const c of b.columns) tr.append(el("td", `${id}-${r.key}-${c.key}`, { text: r.cells[c.key] ?? "" }));
    body.append(tr);
  }
  t.append(head, body);
  return t;
}

function toggle(id: string, b: Extract<Block, { kind: "toggle" }>): HTMLElement {
  const wrap = el("div", id, { cls: "toggle" });
  const input = el("input", `${id}-input`);
  input.type = "checkbox";
  input.checked = b.checked;
  const label = el("label", `${id}-label`, { text: b.label });
  label.htmlFor = input.id;
  input.addEventListener("change", () => {
    input.disabled = true;
    const action =
      b.setting === "checkForUpdates"
        ? ({ type: "setCheckForUpdates", value: input.checked } as const)
        : ({ type: "setStopOnQuit", value: input.checked } as const);
    void act(action).finally(() => {
      input.disabled = false;
    });
  });
  wrap.append(input, label);
  return wrap;
}

function portField(id: string, b: Extract<Block, { kind: "port" }>): HTMLElement {
  const wrap = el("div", id, { cls: "field" });
  const label = el("label", `${id}-label`, { text: b.label });
  const row = el("div", `${id}-row`, { cls: "inline" });
  const input = el("input", `${id}-input`);
  input.type = "number";
  input.min = "1024";
  input.max = "65535";
  input.value = inputs.get(input.id) ?? (b.value !== undefined ? String(b.value) : "");
  label.htmlFor = input.id;
  input.addEventListener("input", () => inputs.set(input.id, input.value));
  const save = el("button", `${id}-save`, { cls: "btn", text: "Save" });
  save.type = "button";
  save.addEventListener("click", () => {
    const port = Number(input.value);
    ui.portPending = undefined;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) ui.portError = "Use a port from 1024 to 65535.";
    else if (port === b.value) ui.portError = "That is the current port.";
    else {
      ui.portError = undefined;
      ui.portPending = port;
    }
    rerender();
  });
  row.append(input, save);
  wrap.append(label, row);
  if (ui.portError) wrap.append(el("p", `${id}-error`, { cls: "text warn", text: ui.portError }));
  const pending = ui.portPending;
  if (pending !== undefined) {
    const box = el("div", `${id}-confirm`, { cls: "confirm" });
    const yes = el("button", `${id}-confirm-yes`, { cls: "btn danger", text: `Restart on port ${pending}` });
    const no = el("button", `${id}-confirm-no`, { cls: "btn", text: "Cancel" });
    yes.type = "button";
    no.type = "button";
    yes.addEventListener("click", () => {
      yes.disabled = true;
      void act({ type: "setPort", port: pending }).then((r) => {
        ui.portPending = undefined;
        ui.portError = r.ok ? undefined : (PORT_ERRORS[r.error] ?? `The port wasn't changed (${r.error}).`);
        rerender();
      });
    });
    no.addEventListener("click", () => {
      ui.portPending = undefined;
      rerender();
    });
    box.append(el("p", `${id}-confirm-text`, { cls: "text", text: b.warning }), yes, no);
    wrap.append(box);
  }
  return wrap;
}

function logsView(id: string, b: Extract<Block, { kind: "logs" }>): HTMLElement {
  const wrap = el("div", id, { cls: "logs" });
  const controls = el("div", `${id}-controls`, { cls: "inline" });
  const selectLabel = el("label", `${id}-service-label`, { text: "Service" });
  const select = el("select", `${id}-service`);
  selectLabel.htmlFor = select.id;
  for (const svc of LOG_SERVICES) {
    const o = el("option", `${id}-service-${svc}`, { text: svc === "all" ? "All services" : svc });
    o.value = svc;
    select.append(o);
  }
  select.value = ui.logs.service;
  const box = el("input", `${id}-requests`);
  box.type = "checkbox";
  box.checked = ui.logs.requestsOnly;
  const boxLabel = el("label", `${id}-requests-label`, { text: "Requests only" });
  boxLabel.htmlFor = box.id;
  const pre = el("pre", `${id}-pre`, { cls: "log", text: filterLogs(b.text, ui.logs) });
  const apply = () => {
    ui.logs = { service: select.value as LogsView["service"], requestsOnly: box.checked };
    pre.textContent = filterLogs(b.text, ui.logs);
  };
  select.addEventListener("change", apply);
  box.addEventListener("change", apply);
  controls.append(selectLabel, select, box, boxLabel);
  wrap.append(controls, pre);
  return wrap;
}

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
    case "table":
      return table(id, b);
    case "toggle":
      return toggle(id, b);
    case "port":
      return portField(id, b);
    case "logs":
      return logsView(id, b);
    case "row": {
      const rowId = b.id ?? id;
      const row = el("div", rowId, { cls: "row-block" });
      row.append(el("p", `${rowId}-text`, { cls: "text", text: b.text }));
      for (const x of b.buttons) row.append(button(rowId, x));
      return row;
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
  if (b.disabled) e.disabled = true;
  e.addEventListener("click", () => {
    if (b.confirm) {
      ui.confirm = b.key;
      rerender();
      return;
    }
    e.disabled = true;
    void act(b.action).finally(() => {
      if (!b.needsInput) e.disabled = false;
    });
  });
  return e;
}

function confirmBox(prefix: string, b: Button): HTMLElement {
  const id = `${prefix}-${b.key}-confirm`;
  const box = el("div", id, { cls: "confirm" });
  const yes = el("button", `${id}-yes`, { cls: "btn danger", text: b.label });
  const no = el("button", `${id}-no`, { cls: "btn", text: "Cancel" });
  yes.type = "button";
  no.type = "button";
  yes.addEventListener("click", () => {
    ui.confirm = undefined;
    yes.disabled = true;
    void act(b.action);
  });
  no.addEventListener("click", () => {
    ui.confirm = undefined;
    rerender();
  });
  box.append(el("p", `${id}-text`, { cls: "text", text: b.confirm ?? "" }), yes, no);
  return box;
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
    const asked = m.buttons.find((b) => b.key === ui.confirm && b.confirm);
    if (asked) section.append(confirmBox(m.id, asked));
  }
  return section;
}

let last = "";
let lastId = "";
let lastFocus = "";
function render(s: ShellState): void {
  lastState = s;
  const label = byId("test-mode-label");
  if (label) label.hidden = !s.test;
  const m = screenModel(s);
  const key = JSON.stringify(m);
  if (key === last) return;
  if (m.id !== lastId) {
    inputs.clear();
    ui = freshUi();
    lastId = m.id;
  }
  last = key;
  const main = byId("shell-main");
  if (!main) return;
  main.replaceChildren(build(m));
  document.body.dataset.screen = m.id;
  document.body.dataset.phase = s.phase;
  const focus = m.focus ? `${m.id}#${m.focus}` : "";
  if (focus && focus !== lastFocus) byId(m.focus ?? "")?.scrollIntoView({ block: "center" });
  lastFocus = focus;
}

document.addEventListener("DOMContentLoaded", () => {
  window.shell.onState(render);
  void window.shell.getState().then(render);
});
