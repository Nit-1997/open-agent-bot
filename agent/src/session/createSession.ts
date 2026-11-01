import type { Model } from "@earendil-works/pi-ai";
import type { ArtifactStore } from "../artifacts/store.js";
import { FrameBus } from "../browser/frames.js";
import type { BrowserPool } from "../browser/pool.js";
import { type AgentConfig, hasCap } from "../config.js";
import type { UserRepos } from "../db/types.js";
import { Evidence } from "../grounding/evidence.js";
import { type Judge, scopeJudge } from "../judge/index.js";
import { log } from "../lib/log.js";
import { createPiSession } from "../pi/createPiSession.js";
import { buildSystemPrompt } from "../prompt/systemPrompt.js";
import type { ProviderHub } from "../providers/hub.js";
import type { UserHubs } from "../providers/hubs.js";
import { loadSkillCatalog, skillsDir } from "../skills/catalog.js";
import { TurnBudget } from "../tools/budget.js";
import { buildTools, PER_REPLY_LIMITS } from "../tools/index.js";
import { completeWith } from "../workflows/llm.js";
import { workspaceCart, workspaceNote } from "../workspace/cart.js";
import { SupabaseWorkspaceStore } from "../workspace/store.js";
import { type CreateSession, sessionKey } from "./sessionStore.js";

type SessionDeps = {
  cfg: AgentConfig;
  hubs: UserHubs;
  repos: (userId: string) => UserRepos;
  artifacts: ArtifactStore;
  pool: BrowserPool;
  judgeFor: (hub: ProviderHub) => () => Promise<Judge>;
};

const modelRef = (m: Model<any>) => `${m.provider}/${m.id}`;

export const NO_MODEL = "Pick a model in Settings → Models.";

export function defaultModelRef(hub: Pick<ProviderHub, "resolve">, chosen: string | undefined): string | null {
  return chosen && hub.resolve(chosen) ? chosen : null;
}

export function pickModel(hub: Pick<ProviderHub, "resolve">, ref: string | undefined, chosen: string | undefined): Model<any> {
  const model = (ref && hub.resolve(ref)) || (chosen && hub.resolve(chosen));
  if (!model) throw new Error(NO_MODEL);
  return model;
}

export function sessionFactory(deps: SessionDeps): CreateSession {
  const { cfg, artifacts, pool } = deps;
  return async (owner, userContext, persona, history) => {
    const { user, chatId } = owner;
    const key = sessionKey(owner);
    const hub = await deps.hubs.get(user);
    const repos = deps.repos(user.id);
    const workspace = new SupabaseWorkspaceStore(repos.workspace, chatId);
    const budget = new TurnBudget(PER_REPLY_LIMITS);
    const evidence = new Evidence();
    const frames = new FrameBus();
    const cart = await workspaceCart(workspace);
    let current = pickModel(hub, userContext?.model, userContext?.profile?.defaultModel);
    const skills = loadSkillCatalog(skillsDir(), { codemode: hasCap(cfg, modelRef(current), "codemode") });
    const turnJudge = scopeJudge(await deps.judgeFor(hub)());
    const handle = await createPiSession({
      runtime: hub.runtime,
      model: current,
      systemPrompt: buildSystemPrompt(userContext, skills, persona),
      tools: buildTools({
        cfg,
        artifacts: artifacts.sink(repos, chatId),
        pool,
        sessionKey: key,
        userContext,
        budget,
        evidence,
        frames,
        cart,
        skills,
        judge: turnJudge,
        workspace,
        complete: completeWith(hub.runtime, () => current),
        braveApiKey: hub.secret("brave-search"),
      }),
      skillsDir: skillsDir(),
      codemode: (m: Model<any>) => hasCap(cfg, modelRef(m), "codemode"),
      onCodemodeOff: (reason: string) => log.info(`[codemode] user=${user.id} thread=${chatId} off for this chat: ${reason}`),
      history,
      contextNote: () => workspaceNote(workspace),
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
        log.debug(`[run] user=${user.id} thread=${chatId} model=${ref}`);
      },
      dispose: async () => {
        await Promise.all([handle.dispose(), pool.close(key)]);
      },
    };
  };
}
