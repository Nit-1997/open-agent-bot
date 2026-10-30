import type { Model } from "@earendil-works/pi-ai";
import type { ArtifactStore } from "../artifacts/store.js";
import { FrameBus } from "../browser/frames.js";
import type { BrowserPool } from "../browser/pool.js";
import { type AgentConfig, hasCap } from "../config.js";
import { Evidence } from "../grounding/evidence.js";
import { defaultModelRef } from "../http/defaultModel.js";
import { type Judge, scopeJudge } from "../judge/index.js";
import { createPiSession } from "../pi/createPiSession.js";
import { buildSystemPrompt } from "../prompt/systemPrompt.js";
import type { ProviderHub } from "../providers/hub.js";
import { loadSkillCatalog, skillsDir } from "../skills/catalog.js";
import { TurnBudget } from "../tools/budget.js";
import { buildTools, PER_REPLY_LIMITS } from "../tools/index.js";
import { completeWith } from "../workflows/llm.js";
import { workspaceCart, workspaceNote } from "../workspace/cart.js";
import type { WorkspaceStore } from "../workspace/store.js";
import type { SessionStore } from "./sessionStore.js";

type CreateSession = ConstructorParameters<typeof SessionStore>[0]["create"];

export type SessionDeps = {
  cfg: AgentConfig;
  hub: ProviderHub;
  artifacts: ArtifactStore;
  pool: BrowserPool;
  workspace: WorkspaceStore;
  judge: () => Promise<Judge>;
};

const modelRef = (m: Model<any>) => `${m.provider}/${m.id}`;

export function pickModel(cfg: AgentConfig, hub: Pick<ProviderHub, "resolve" | "enabledModels">, ref: string | undefined): Model<any> {
  const fallback = defaultModelRef(cfg, hub);
  const model = (ref && hub.resolve(ref)) || (fallback && hub.resolve(fallback));
  if (!model) throw new Error("No model is set up yet. Add a provider in Settings → Models.");
  return model;
}

export function sessionFactory(deps: SessionDeps): CreateSession {
  const { cfg, hub, artifacts, pool, workspace } = deps;
  return async (threadId, userContext, history) => {
    const budget = new TurnBudget(PER_REPLY_LIMITS);
    const evidence = new Evidence();
    const frames = new FrameBus();
    const cart = workspaceCart(workspace, threadId);
    let current = pickModel(cfg, hub, userContext?.model);
    const skills = loadSkillCatalog(skillsDir(), { codemode: hasCap(cfg, modelRef(current), "codemode") });
    const turnJudge = scopeJudge(await deps.judge());
    const handle = await createPiSession({
      runtime: hub.runtime,
      model: current,
      systemPrompt: buildSystemPrompt(userContext, skills),
      tools: buildTools({
        cfg,
        artifacts,
        pool,
        threadId,
        userContext,
        budget,
        evidence,
        frames,
        cart,
        skills,
        judge: turnJudge,
        workspace,
        complete: completeWith(hub.runtime, () => current),
      }),
      skillsDir: skillsDir(),
      codemode: (m: Model<any>) => hasCap(cfg, modelRef(m), "codemode"),
      onCodemodeOff: (reason: string) => console.log(`[codemode] thread=${threadId} off for this chat: ${reason}`),
      history,
      contextNote: () => workspaceNote(workspace, threadId),
    });
    return {
      session: handle.session,
      busy: false,
      lastUsed: Date.now(),
      onRunStart: () => {
        budget.reset();
        turnJudge.reset();
      },
      turnStats: () => {
        const u = turnJudge.usage();
        return { jevCalls: u.calls, jevCostUsd: u.costUsd };
      },
      evidence,
      frames,
      cart,
      setModel: async (ref: string) => {
        const model = hub.resolve(ref);
        if (!model) throw new Error(`The model ${ref} isn't available any more. Pick another one from the model menu.`);
        await handle.setModel(model);
        current = model;
        console.log(`[run] thread=${threadId} model=${ref}`);
      },
      dispose: async () => {
        await Promise.all([handle.dispose(), pool.close(threadId)]);
      },
    };
  };
}
