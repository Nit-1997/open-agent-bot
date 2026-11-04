import { createRequire } from "node:module";
import { resolve } from "node:path";

const { serveTree, startMockReleases } = createRequire(import.meta.url)("./mockReleases.ts") as typeof import("./mockReleases.ts");

async function cli(argv: readonly string[]): Promise<void> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(arg("--port"));
  const dir = arg("--dir");
  if (!Number.isInteger(port) || port < 18000 || port > 19999 || !dir) {
    process.stderr.write("usage: mockReleasesCli.mts --port <18000-19999> --dir <tree> [--log <file>]\n");
    process.exit(64);
  }
  const log = arg("--log");
  const m = await startMockReleases({ port, ...(log ? { log: resolve(log) } : {}) });
  serveTree(m, resolve(dir));
  process.stdout.write(`[mock-releases] listening ${m.latestUrl}\n`);
  const stop = () => void m.stop().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void cli(process.argv.slice(2));
