import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createFakeDocker, fakeServices } from "./support/fakeDocker";
import { launchShell, newStateDir, seedStack } from "./support/launch";

const PORT = 18422;
const PROJECT = "oab-e2e-desktop-state";
const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);

test("a group-readable stack.json is distrusted: warn, rotate the token, rewrite 0600, and the app still works", async () => {
  const stateDir = newStateDir("state");
  const stackFile = join(stateDir, "stack.json");
  const old = randomBytes(32).toString("hex");
  seedStack(stateDir, { project: PROJECT, port: PORT, token: old });
  chmodSync(stackFile, 0o644);
  const fake = await createFakeDocker("state");
  const env = {
    stateDir,
    project: PROJECT,
    portRange: `${PORT}-${PORT}`,
    docker: fake.bin,
    services: fakeServices(stateDir),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
  };
  const shell = await launchShell(env, test.info());
  try {
    const appPage = await shell.appPage();
    await expect.poll(() => shell.log()).toContain("[state] stack.json wide_mode; token discarded and rotated");
    const rotated = JSON.parse(readFileSync(stackFile, "utf8")).launchToken as string;
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(fp(rotated)).not.toBe(fp(old));
    expect(statSync(stackFile).mode & 0o777).toBe(0o600);
    expect(shell.log()).toContain(`fp=${fp(rotated)}`);
    expect(await appPage.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
    for (const t of [old, rotated]) expect(shell.log()).not.toContain(t);
  } finally {
    await shell.app.close().catch(() => {});
    await fake.cleanup();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
