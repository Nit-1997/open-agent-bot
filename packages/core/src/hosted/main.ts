import { ConfigError, loadConfig } from "@oab/core/config.js";
import { startAgent } from "@oab/core/startAgent.js";
import { ambientProviderEnv } from "./ambientEnv.js";
import { hostedAgentDeps } from "./deps.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig(process.env);
} catch (err) {
  fail(err instanceof ConfigError ? err.message : `agent configuration failed: ${String(err)}`);
}
const ambient = await ambientProviderEnv(process.env);
if (ambient.length) {
  fail(
    `refusing to start: provider credentials in the environment would serve every user (${ambient.join(", ")}). Remove them; users add keys in the app.`,
  );
}

const agent = await startAgent(hostedAgentDeps(cfg).deps);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    void agent.close().finally(() => process.exit(0));
  });
}
