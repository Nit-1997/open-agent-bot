process.umask(0o077);

const { refuse } = await import("./refusal.js");
const { startLocal } = await import("./start.js");

let local: Awaited<ReturnType<typeof startLocal>>;
try {
  local = await startLocal(process.env);
} catch (err) {
  refuse(err);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    local.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
