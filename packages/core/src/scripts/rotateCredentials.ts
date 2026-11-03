import { loadConfig } from "../config.js";
import { LocalKeyWrapper } from "../secrets/keyWrapper.js";
import { rotateStale } from "../hosted/secrets/rotate.js";
import { createServiceClient } from "../hosted/store/client.js";
import { createRotationRepo } from "../hosted/store/rotation.js";

const cfg = loadConfig(process.env);
const r = await rotateStale(createRotationRepo(createServiceClient(cfg)), new LocalKeyWrapper(cfg.credentialKeys), (line) =>
  console.error(line),
);
console.log(`rewrapped ${r.rewrapped}; ${r.left} rows below current (v${r.current})${r.failed ? `; ${r.failed} failed` : ""}`);
process.exit(r.left === 0 ? 0 : 1);
