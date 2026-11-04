import type { ShellState } from "./actions.ts";
import type { Block } from "./screenModel.ts";
import { incompatibleText } from "./updateText.ts";

const TOKEN_SENTENCE = "A launch key that only this app knows protects your services: other users and programs on this Mac can't use them.";

function servicesNote(s: ShellState): Block[] {
  const reason = s.update?.incompatible;
  if (s.localBuild || s.update?.services || !reason) return [];
  return [{ kind: "p", key: "services-update", tone: "warn", text: incompatibleText(reason) }];
}

function checkText(u: ShellState["update"]): string {
  if (u?.checking) return "Checking…";
  if (u?.error) return `Couldn't check: ${u.error}`;
  if (u?.checked && !u.shell) return "Open Agent is up to date";
  return "";
}

export function aboutBlocks(s: ShellState): Block[] {
  const u = s.update;
  const blocks: Block[] = [
    {
      kind: "rows",
      key: "about",
      rows: [
        { key: "app", label: "App version", value: u?.appVersion ?? "unknown" },
        { key: "services", label: "Services version", value: s.servicesVersion ?? "unknown" },
        { key: "licence", label: "Licence", value: "MIT" },
      ],
    },
    { kind: "p", key: "token", tone: "muted", text: TOKEN_SENTENCE },
  ];
  if (u?.shell)
    blocks.push({
      kind: "row",
      key: "update-row",
      id: "update-row",
      text: `Open Agent ${u.shell} is available`,
      buttons: [
        { key: "download", label: "Download", action: { type: "downloadUpdate" }, tone: "primary" },
        ...(u.dismissed ? [] : [{ key: "later", label: "Later", action: { type: "dismissUpdate" as const } }]),
      ],
    });
  blocks.push(...servicesNote(s), {
    kind: "row",
    key: "check",
    text: checkText(u),
    buttons: [{ key: "check", label: "Check for updates…", action: { type: "checkForUpdates" } }],
  });
  return blocks;
}
