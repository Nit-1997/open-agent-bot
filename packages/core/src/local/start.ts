import type { AddressInfo } from "node:net";
import { createBff, localAuth } from "@oab/bff";
import { serve } from "@hono/node-server";
import { LOCAL_USER_EMAIL, LOCAL_USER_ID } from "@oab/shared/local";
import { createLocalIdentity } from "../identity/localIdentity.js";
import type { Identity } from "../identity/types.js";
import { log } from "../lib/log.js";
import { LocalKeyWrapper } from "../secrets/keyWrapper.js";
import { type RunningAgent, startAgent } from "../startAgent.js";
import { loadLocalConfig } from "./config.js";
import { createLocalFront } from "./front.js";
import { localHosts, localOrigins } from "./hosts.js";
import { loadLocalKeys, newAgentSecret, newHexSecret } from "./keyFiles.js";
import { StartupRefusal } from "./refusal.js";
import { openSqliteStore } from "./store/sqliteStore.js";

export type LocalSeams = Readonly<{ identity?: (secret: string) => Identity }>;

export type RunningLocal = Readonly<{ port: number; close(): Promise<void> }>;

const CORE_URL = "http://core.internal";

type Server = ReturnType<typeof serve>;

function listen(fetch: (req: Request) => Response | Promise<Response>, hostname: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname, port }, () => resolve(server));
    server.once("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
}

export async function startLocal(env: NodeJS.ProcessEnv, seams: LocalSeams = {}): Promise<RunningLocal> {
  const settings = loadLocalConfig(env, { rendererSecret: newHexSecret() });
  const store = openSqliteStore({ dir: settings.dataDir });
  let agent: RunningAgent | undefined;
  try {
    store.ensureUser(LOCAL_USER_ID, LOCAL_USER_EMAIL);
    const keys = loadLocalKeys({
      keysDir: settings.keysDir,
      rendererDir: settings.rendererDir,
      credentialRows: () => store.credentialCount(),
      reset: settings.resetCredentials,
      resetCredentials: () => store.resetCredentials(),
    });
    const secret = newAgentSecret();
    const identity = (seams.identity ?? ((s: string) => createLocalIdentity({ secret: s })))(secret);
    if (identity.kind !== "local")
      throw new StartupRefusal("identity", `the local entry needs a local identity, got ${String(identity.kind)}`);
    agent = await startAgent({
      config: { ...settings, rendererSecret: keys.rendererSecret },
      store,
      identity,
      keyWrapper: new LocalKeyWrapper(keys.kek),
      listen: false,
    });
    const core = agent;
    const bff = createBff({
      agentUrl: CORE_URL,
      appOrigin: localOrigins(settings.publicPort),
      allowedHosts: localHosts(settings.publicPort),
      auth: localAuth({ secret, launchToken: settings.launchToken }),
      fetch: ((input: string | URL | Request, init?: RequestInit) => core.app.fetch(new Request(input, init))) as typeof fetch,
    });
    const front = createLocalFront({ uiDir: settings.uiDir, port: settings.publicPort, bff });
    const server = await listen(front.fetch, settings.listenHost, settings.listenPort);
    const address = server.address() as AddressInfo;
    log.info(`[local] listening on ${address.address}:${address.port}`);
    let closing: Promise<void> | undefined;
    return Object.freeze({
      port: address.port,
      close: () =>
        (closing ??= (async () => {
          await closeServer(server);
          await core.close();
        })()),
    });
  } catch (err) {
    await (agent ? agent.close() : store.close());
    throw err;
  }
}
