import { shutdownOnSignals } from "./shutdown.js";

process.umask(0o077);

const shutdown = shutdownOnSignals({ signals: process, exit: (code) => process.exit(code), warn: (line) => console.error(line) });

const { refuse } = await import("./refusal.js");
const { startLocal } = await import("./start.js");

try {
  shutdown.ready(await startLocal(process.env));
} catch (err) {
  refuse(err);
}
