import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type ContextEvent,
  createCodemodeExtension,
  type ExtensionAPI,
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

const CODEMODE = "codemode";

export type PiSession = AgentSession;

type PiSessionHandle = {
  session: PiSession;
  setModel: (model: Model<any>) => Promise<void>;
  codemodeActive: () => boolean;
  dispose: () => Promise<void>;
};

type CodemodeCall = { name?: string; status?: string; error?: string };

const BUDGET_REFUSAL = /^Budget for /;

export function codemodeFailure(isError: boolean, result: unknown): string | undefined {
  if (isError) return "the script failed";
  const calls = (result as { details?: { calls?: CodemodeCall[] } } | undefined)?.details?.calls ?? [];
  const failed = calls.filter((c) => c.status === "error" && !BUDGET_REFUSAL.test(c.error ?? ""));
  return failed.length ? `${failed.length} tool call(s) in the script failed (${[...new Set(failed.map((c) => c.name))].join(", ")})` : undefined;
}

type AgentMessage = ContextEvent["messages"][number];

type SeedMessage = { role: "user" | "assistant"; text: string };

function seed(sessionManager: SessionManager, model: Model<any>, history: SeedMessage[]): void {
  const timestamp = Date.now();
  for (const m of history) {
    if (m.role === "user") sessionManager.appendMessage({ role: "user", content: m.text, timestamp });
    else {
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: m.text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp,
      });
    }
  }
}

function withNote(messages: AgentMessage[], note: string): AgentMessage[] {
  const at = messages.map((m) => m.role).lastIndexOf("user");
  if (at < 0) return messages;
  const m = messages[at] as { content: string | { type: string; text?: string }[] };
  const content = typeof m.content === "string" ? `${note}\n\n${m.content}` : [{ type: "text", text: `${note}\n\n` }, ...m.content];
  return messages.map((x, i) => (i === at ? ({ ...x, content } as AgentMessage) : x));
}

export async function createPiSession(opts: {
  runtime: ModelRuntime;
  model: Model<any>;
  systemPrompt: string;
  tools: ToolDefinition<any, any, any>[];
  skillsDir?: string;
  history?: SeedMessage[];
  contextNote?: () => string | undefined;
  codemode?: (model: Model<any>) => boolean;
  onCodemodeOff?: (reason: string) => void;
}): Promise<PiSessionHandle> {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-"));
  const settingsManager = SettingsManager.inMemory();
  if (opts.codemode) settingsManager.applyOverrides({ defaultTools: ["+codemode"] });
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    ...((opts.contextNote || opts.codemode) && {
      extensionFactories: [
        ...(opts.contextNote
          ? [
              (pi: ExtensionAPI) => {
                pi.on("context", (event) => {
                  const note = opts.contextNote?.();
                  return note ? { messages: withNote(event.messages, note) } : undefined;
                });
              },
            ]
          : []),
        ...(opts.codemode ? [createCodemodeExtension({ mode: "on" })] : []),
      ],
    }),
    noSkills: true,
    ...(opts.skillsDir && { additionalSkillPaths: [opts.skillsDir] }),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: opts.systemPrompt,
  });
  await resourceLoader.reload();

  const sessionManager = SessionManager.inMemory(dir);
  if (opts.history?.length) seed(sessionManager, opts.model, opts.history);

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: opts.runtime,
    model: opts.model,
    thinkingLevel: "off",
    noTools: "builtin",
    customTools: opts.tools,
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  let codemodeOff = false;
  const syncCodemode = (model: Model<any>) => {
    if (!opts.codemode) return;
    const active = session.getActiveToolNames().filter((n) => n !== CODEMODE);
    session.setActiveToolsByName(!codemodeOff && opts.codemode(model) ? [...active, CODEMODE] : active);
  };
  syncCodemode(opts.model);
  if (opts.codemode) {
    session.subscribe((e) => {
      if (codemodeOff || e.type !== "tool_execution_end" || e.toolName !== CODEMODE || !session.getActiveToolNames().includes(CODEMODE)) return;
      const reason = codemodeFailure(e.isError, e.result);
      if (!reason) return;
      codemodeOff = true;
      syncCodemode(session.model ?? opts.model);
      opts.onCodemodeOff?.(reason);
    });
  }

  return {
    session,
    setModel: async (model) => {
      if (session.model?.provider === model.provider && session.model?.id === model.id) return;
      await session.setModel(model);
      syncCodemode(model);
    },
    codemodeActive: () => session.getActiveToolNames().includes(CODEMODE),
    dispose: async () => {
      session.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
