import { Hono } from "hono";
import type { ArtifactStore } from "./artifacts/store.js";
import type { AgentConfig } from "./config.js";
import type { RunOptions } from "./agui/runHandler.js";
import { aguiRoutes } from "./http/agui.js";
import { artifactRoutes } from "./http/artifacts.js";
import { type OnboardingDeps, onboardingRoutes } from "./http/onboarding.js";
import { profileRoutes } from "./http/profile.js";
import { providerRoutes } from "./http/providers.js";
import { settingsRoutes } from "./http/settings.js";
import type { ProfileStore } from "./profile/store.js";
import type { ProviderHub } from "./providers/hub.js";
import type { LoginFlows } from "./providers/logins.js";
import type { SessionStore } from "./session/sessionStore.js";

export function createApp(deps: {
  cfg: AgentConfig;
  store: SessionStore;
  artifacts?: ArtifactStore;
  hub?: ProviderHub;
  logins?: LoginFlows;
  profiles?: ProfileStore;
  onboarding?: OnboardingDeps;
  run?: RunOptions;
}) {
  const authorized = (secret: string | undefined) => !deps.cfg.sharedSecret || secret === deps.cfg.sharedSecret;
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", artifactRoutes(deps.artifacts));
  app.route("/", providerRoutes({ hub: deps.hub, logins: deps.logins, profiles: deps.profiles, authorized }));
  app.route("/", profileRoutes({ profiles: deps.profiles, authorized }));
  app.route("/", settingsRoutes({ hub: deps.hub, authorized }));
  app.route("/", onboardingRoutes({ ...deps.onboarding, authorized }));
  app.route("/", aguiRoutes({ store: deps.store, authorized, run: deps.run }));

  return app;
}
