import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export type PiSession = AgentSession;

export type PiSessionHandle = {
  session: PiSession;
  setModel: (model: Model<any>) => Promise<void>;
  dispose: () => Promise<void>;
};

export async function createPiSession(opts: {
  runtime: ModelRuntime;
  model: Model<any>;
  systemPrompt: string;
  tools: ToolDefinition<any, any, any>[];
  skillsDir?: string;
}): Promise<PiSessionHandle> {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-"));
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    ...(opts.skillsDir && { additionalSkillPaths: [opts.skillsDir] }),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: opts.systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: opts.runtime,
    model: opts.model,
    thinkingLevel: "off",
    noTools: "builtin",
    customTools: opts.tools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager,
  });

  return {
    session,
    setModel: async (model) => {
      if (session.model?.provider === model.provider && session.model?.id === model.id) return;
      await session.setModel(model);
    },
    dispose: async () => {
      session.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
