import { ConfigError } from "@oab/core/config.js";
import { log } from "@oab/core/lib/log.js";
import { startAgent } from "@oab/core/startAgent.js";
import { ambientProviderEnv } from "./ambientEnv.js";
import { type HostedConfig, loadHostedConfig } from "./config.js";
import { hostedAgentDeps } from "./deps.js";
import { limitsLine } from "./limits/config.js";
import { checkUsageFunctions, GATE8_REFUSAL } from "./limits/startup.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let cfg: HostedConfig;
try {
  cfg = loadHostedConfig(process.env);
} catch (err) {
  fail(err instanceof ConfigError ? err.message : `agent configuration failed: ${String(err)}`);
}
const ambient = await ambientProviderEnv(process.env);
if (ambient.length) {
  fail(
    `refusing to start: provider credentials in the environment would serve every user (${ambient.join(", ")}). Remove them; users add keys in the app.`,
  );
}

const hosted = hostedAgentDeps(cfg);
log.info(limitsLine(cfg.limits));
if ((await checkUsageFunctions(hosted.usage)) === "missing") fail(GATE8_REFUSAL);

const agent = await startAgent(hosted.deps);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    void agent.close().finally(() => process.exit(0));
  });
}
