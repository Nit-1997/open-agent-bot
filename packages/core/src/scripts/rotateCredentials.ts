import { loadConfig } from "../config.js";
import { rotateStale } from "../crypto/rotate.js";
import { LocalKeyWrapper } from "../crypto/keyWrapper.js";
import { createServiceClient } from "../db/client.js";
import { createRotationRepo } from "../db/rotation.js";

const cfg = loadConfig(process.env);
const r = await rotateStale(createRotationRepo(createServiceClient(cfg)), new LocalKeyWrapper(cfg.credentialKeys), (line) =>
  console.error(line),
);
console.log(`rewrapped ${r.rewrapped}; ${r.left} rows below current (v${r.current})${r.failed ? `; ${r.failed} failed` : ""}`);
process.exit(r.left === 0 ? 0 : 1);
