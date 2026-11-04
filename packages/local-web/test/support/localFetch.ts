import { emptyProfile, type Profile } from "@oab/shared/profile";

export const ONBOARDED: Profile = { ...emptyProfile(), name: "Local Person", onboardedAt: "2026-11-03" };

export function localRespond(url: string, profile: Profile = ONBOARDED): Response {
  const path = url.split("?")[0];
  if (path === "/api/profile") return Response.json({ profile });
  if (path === "/api/models")
    return Response.json({ default: "openrouter/a", models: [{ id: "openrouter/a", label: "A", provider: "OpenRouter" }] });
  if (path === "/api/chats") return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
  if (path === "/api/reports") return Response.json({ items: [], total: 0, page: 1, pageSize: 12 });
  if (path === "/api/onboarding/options") return Response.json({ rows: {} });
  return Response.json({ error: "not_found" }, { status: 404 });
}
