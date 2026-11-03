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
  | { type: "closeServices" }
  | { type: "confirmReset" }
  | { type: "confirmDelete" }
  | { type: "back" }
  | { type: "discardPendingDelete" }
  | { type: "relaunch" };

export type ActError = "invalid_action" | "not_confirming" | "not_available" | "forbidden" | "busy" | "invalid_port";
export type ActResult = { ok: true } | { ok: false; error: ActError };

export type ScreenId = "app" | "screen-progress" | "screen-confirm-delete" | "screen-confirm-reset" | (string & {});

export type PullRow = Readonly<{
  name: string;
  ref: string;
  layersDone: number;
  layersTotal: number;
  bytesDone?: number;
  bytesTotal?: number;
  done: boolean;
}>;
export type ServiceRow = Readonly<{ service: string; state: string; health: string }>;
export type EngineInfo = Readonly<{
  cli: string;
  context: string;
  engine: string;
  engineName: string;
  compose: string;
  server: string;
  socket?: string;
  memBytes?: number;
  memWarning: boolean;
}>;

export type ShellState = Readonly<{
  phase: string;
  screen: ScreenId;
  test: boolean;
  port?: number;
  localBuild?: string;
  servicesVersion?: string;
  engine?: EngineInfo;
  apps?: Readonly<{ dockerDesktop: boolean; orbstack: boolean; colima: boolean }>;
  docker?: Readonly<{ searched: readonly string[]; rejected: readonly Readonly<{ path: string; reason: string }>[] }>;
  remote?: Readonly<{ endpoint: string; reason: string; owner?: number }>;
  compose?: Readonly<{ version?: string }>;
  pull?: readonly PullRow[];
  services?: readonly ServiceRow[];
  refusal?: Readonly<{ code: string; line: string; exitCode: number; count?: number }>;
  failure?: Readonly<{ reason: string; step?: string; exitCode?: number; detail?: string; tail?: string }>;
  foreign?: Readonly<{
    workingDir: string;
    version?: string;
    port?: number;
    dataVolume?: string;
    keysVolume?: string;
    ourDataVolume: string;
    ourKeysVolume: string;
  }>;
  conflict?: Readonly<{ port: number }>;
  disk?: Readonly<{ where: "docker" | "mac"; engine: string; line: string; detail?: string }>;
  stopping?: Readonly<{ what: string }>;
  stopped?: Readonly<{ reason: string; exitCode?: number; tail?: string }>;
  logs?: Readonly<{ text: string }>;
  confirm?: Readonly<{ count?: number; dataVolume: string; keysVolume: string }>;
  pendingDelete?: Readonly<{
    stored: Readonly<{ project: string; dataVolume: string; keysVolume: string }>;
    current: Readonly<{ project: string; dataVolume: string; keysVolume: string }>;
  }>;
  settings?: Readonly<{ stopOnQuit: boolean; checkForUpdates: boolean }>;
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
  confirmReset: {},
  confirmDelete: {},
  back: {},
  discardPendingDelete: {},
  relaunch: {},
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
