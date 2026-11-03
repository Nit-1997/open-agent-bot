import { createHash } from "node:crypto";
import { loadOrCreateSecretFile, newKekFile, parseKekFile } from "../../../src/local/keyFiles.js";

process.umask(0);
const [path, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) {}
const kek = loadOrCreateSecretFile({ path, generate: newKekFile, parse: parseKekFile, label: "credential key" });
process.stdout.write(createHash("sha256").update(kek.keys.get(kek.current)!).digest("hex"));
