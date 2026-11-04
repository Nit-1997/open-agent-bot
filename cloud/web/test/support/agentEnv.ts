import { vi } from "vitest";

export const APP_ORIGIN = "https://app.test";
export const AGENT_URL = "http://agent.test:8000";
export const SERVICE_SECRET = "a".repeat(64);
export const AUTH = { userId: "11111111-1111-4111-8111-111111111111", accessToken: "user-access-token" };

export function stubAgentEnv(): void {
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  vi.stubEnv("AGENT_URL", AGENT_URL);
  vi.stubEnv("AGENT_SERVICE_SECRET", SERVICE_SECRET);
}

export function headersOf(call: unknown[]): Headers {
  return new Headers((call[1] as RequestInit | undefined)?.headers);
}
