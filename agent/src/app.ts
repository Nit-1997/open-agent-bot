import { Hono } from "hono";
import type { AccessService } from "./access/service.js";
import type { AdminService } from "./admin/service.js";
import type { RunContext } from "./agui/runHandler.js";
import type { ArtifactStore } from "./artifacts/store.js";
import type { AuthEnv, Guards } from "./auth/middleware.js";
import type { AuthUser } from "./auth/verify.js";
import type { UserRepos } from "./db/types.js";
import { accessRoutes } from "./http/access.js";
import { adminRoutes } from "./http/admin.js";
import { aguiRoutes } from "./http/agui.js";
import { artifactRoutes } from "./http/artifacts.js";
import { chatRoutes } from "./http/chats.js";
import { type OnboardingDeps, onboardingRoutes } from "./http/onboarding.js";
import { type ProfilesFor, profileRoutes } from "./http/profile.js";
import { providerRoutes } from "./http/providers.js";
import { settingsRoutes } from "./http/settings.js";
import type { ConcurrencyGate, RateLimiter } from "./lib/rateLimit.js";
import type { UserHubs } from "./providers/hubs.js";
import type { LoginFlows } from "./providers/logins.js";
import type { SessionStore } from "./session/sessionStore.js";

export type AppDeps = {
  guards: Guards;
  limiter: RateLimiter;
  gate: ConcurrencyGate;
  store: SessionStore;
  runContext: (user: AuthUser, chatId: string) => RunContext;
  repos: (userId: string) => UserRepos;
  profiles: ProfilesFor;
  hubs: UserHubs;
  logins: LoginFlows;
  artifacts: ArtifactStore;
  onboarding: OnboardingDeps;
  access: AccessService;
  admin: AdminService;
};

const USER_PATHS = [
  "/agui",
  "/chats",
  "/chats/*",
  "/profile",
  "/settings",
  "/settings/*",
  "/places",
  "/onboarding/*",
  "/models",
  "/providers",
  "/providers/*",
  "/artifacts/*",
];

export function createApp(deps: AppDeps) {
  const app = new Hono<AuthEnv>();
  const { guards } = deps;

  app.get("/health", (c) => c.json({ ok: true }));
  app.on("OPTIONS", "*", (c) => c.json({ error: "method_not_allowed" }, 405));
  app.use("*", guards.requireService);

  app.route("/", accessRoutes({ access: deps.access }));

  for (const path of USER_PATHS) app.use(path, guards.requireUser);
  app.use("/admin/*", guards.requireAdmin);

  app.route("/", aguiRoutes({ store: deps.store, context: deps.runContext, limiter: deps.limiter, gate: deps.gate }));
  app.route("/", chatRoutes({ repos: deps.repos, limiter: deps.limiter }));
  app.route("/", profileRoutes({ profiles: deps.profiles, limiter: deps.limiter }));
  app.route("/", settingsRoutes({ hubs: deps.hubs, limiter: deps.limiter }));
  app.route("/", onboardingRoutes({ ...deps.onboarding, limiter: deps.limiter }));
  app.route("/", providerRoutes({ hubs: deps.hubs, logins: deps.logins, profiles: deps.profiles, limiter: deps.limiter }));
  app.route("/", artifactRoutes({ artifacts: deps.artifacts, owner: deps.repos }));
  app.route("/", adminRoutes({ admin: deps.admin, limiter: deps.limiter }));
  app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));

  return app;
}
