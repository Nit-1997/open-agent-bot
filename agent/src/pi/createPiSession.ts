import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../config.js";
import { LITELLM_PROVIDER, registerLitellm } from "./litellmProvider.js";

export type PiSession = AgentSession;

export type PiSessionHandle = {
  session: PiSession;
  dispose: () => Promise<void>;
};

export async function createPiSession(opts: {
  cfg: AgentConfig;
  systemPrompt: string;
  tools: ToolDefinition<any, any, any>[];
}): Promise<PiSessionHandle> {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-"));
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  registerLitellm(modelRuntime, opts.cfg);
  const model = modelRuntime.getModel(LITELLM_PROVIDER, opts.cfg.model);
  if (!model) throw new Error(`model ${opts.cfg.model} not registered`);

  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: opts.systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    model,
    thinkingLevel: "off",
    noTools: "builtin",
    customTools: opts.tools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager,
  });

  return {
    session,
    dispose: async () => {
      session.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
