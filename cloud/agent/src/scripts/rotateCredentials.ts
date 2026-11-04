import { loadHostedConfig } from "../config.js";
import { rotateStale } from "../secrets/rotate.js";
import { createServiceClient } from "../store/client.js";
import { createRotationRepo } from "../store/rotation.js";
import { LocalKeyWrapper } from "@oab/core/secrets/keyWrapper.js";

const cfg = loadHostedConfig(process.env);
const r = await rotateStale(createRotationRepo(createServiceClient(cfg)), new LocalKeyWrapper(cfg.credentialKeys), (line) =>
  console.error(line),
);
console.log(`rewrapped ${r.rewrapped}; ${r.left} rows below current (v${r.current})${r.failed ? `; ${r.failed} failed` : ""}`);
process.exit(r.left === 0 ? 0 : 1);
