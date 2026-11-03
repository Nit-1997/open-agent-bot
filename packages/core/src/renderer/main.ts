import { log, setLogLevel } from "../lib/log.js";
import { ChromiumRenderer } from "./chromium.js";
import { createRendererServer, rendererStartup } from "./server.js";

const PORT = 8100;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const startup = rendererStartup(process.env);
if (!startup.ok) fail(startup.message);
const { secret } = startup;
if (process.env.LOG_LEVEL === "debug") setLogLevel("debug");

const engine = new ChromiumRenderer({ sandbox: true });
try {
  await engine.pdf("<p>ready</p>");
} catch (err) {
  log.error("[renderer] Chromium failed to start with its sandbox", err);
  process.exit(1);
}

const server = createRendererServer({ secret, engine });
server.listen(PORT, "0.0.0.0", () => log.info(`renderer listening on :${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void engine.close().finally(() => process.exit(0));
  });
}
