import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Targets, type TransportInput } from "../../../packages/core/evals/run.js";

export const CLI_TARGETS: Targets = Object.freeze({
  hosted: async (input: TransportInput) => (await import("./auth/hosted.js")).hostedTarget(input),
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), CLI_TARGETS).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
