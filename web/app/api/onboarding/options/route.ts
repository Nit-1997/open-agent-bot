import { forwardToAgent } from "@/lib/agentServer";

export function GET(req: Request) {
  const from = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const key of ["lat", "lon", "country"]) {
    const v = from.get(key);
    if (v) params.set(key, v.slice(0, 20));
  }
  return forwardToAgent(req, `/onboarding/options?${params}`);
}
