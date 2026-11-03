export const LINK_IDS = [
  "get-docker-desktop",
  "get-orbstack",
  "get-colima",
  "install-guide",
  "github",
  "release-page",
  "startup-errors",
] as const;
export type LinkId = (typeof LINK_IDS)[number];

export type ShellAction =
  | { type: "retry" }
  | { type: "quit" }
  | { type: "openDockerApp"; app: "docker-desktop" | "orbstack" }
  | { type: "openLink"; link: LinkId }
  | { type: "useAppStack" }
  | { type: "pickAnotherPort" }
  | { type: "resetCredentials"; confirm: "reset" }
  | { type: "restartServices" }
  | { type: "updateServices" }
  | { type: "cancelPull" }
  | { type: "setStopOnQuit"; value: boolean }
  | { type: "setPort"; port: number }
  | { type: "setCheckForUpdates"; value: boolean }
  | { type: "checkForUpdates" }
  | { type: "downloadUpdate" }
  | { type: "dismissUpdate" }
  | { type: "moveToApplications" }
  | { type: "keepHere" }
  | { type: "showLogs" }
  | { type: "saveLogs" }
  | { type: "exportData" }
  | { type: "deleteData"; confirm: "delete" }
  | { type: "closeServices" };

export type ActError = "invalid_action" | "not_confirming" | "not_available" | "forbidden";
export type ActResult = { ok: true } | { ok: false; error: ActError };

export type ScreenId = "app" | "screen-progress" | "screen-confirm-delete" | "screen-confirm-reset" | (string & {});

export type ShellState = Readonly<{
  phase: string;
  screen: ScreenId;
  test: boolean;
  port?: number;
}>;

export type ShellBridge = Readonly<{
  getState(): Promise<ShellState>;
  onState(cb: (s: ShellState) => void): void;
  act(action: ShellAction): Promise<ActResult>;
}>;

export type DesktopBridge = Readonly<{ openServices(): void }>;

type Field = "boolean" | "port" | readonly string[];

const SHAPES: Readonly<Record<ShellAction["type"], Readonly<Record<string, Field>>>> = {
  retry: {},
  quit: {},
  openDockerApp: { app: ["docker-desktop", "orbstack"] },
  openLink: { link: LINK_IDS },
  useAppStack: {},
  pickAnotherPort: {},
  resetCredentials: { confirm: ["reset"] },
  restartServices: {},
  updateServices: {},
  cancelPull: {},
  setStopOnQuit: { value: "boolean" },
  setPort: { port: "port" },
  setCheckForUpdates: { value: "boolean" },
  checkForUpdates: {},
  downloadUpdate: {},
  dismissUpdate: {},
  moveToApplications: {},
  keepHere: {},
  showLogs: {},
  saveLogs: {},
  exportData: {},
  deleteData: { confirm: ["delete"] },
  closeServices: {},
};

const fieldOk = (field: Field, v: unknown): boolean => {
  if (field === "boolean") return typeof v === "boolean";
  if (field === "port") return typeof v === "number" && Number.isInteger(v) && v >= 1024 && v <= 65535;
  return typeof v === "string" && field.includes(v);
};

export function validateAction(v: unknown): ShellAction | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return undefined;
  const record = v as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !Object.hasOwn(SHAPES, type)) return undefined;
  const shape = SHAPES[type as ShellAction["type"]];
  const keys = Object.keys(record);
  if (keys.length !== Object.keys(shape).length + 1) return undefined;
  for (const key of keys) {
    if (key === "type") continue;
    const field = shape[key];
    if (field === undefined || !Object.hasOwn(shape, key) || !fieldOk(field, record[key])) return undefined;
  }
  return { ...record } as ShellAction;
}
