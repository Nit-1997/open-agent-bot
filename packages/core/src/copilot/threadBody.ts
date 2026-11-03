export type ThreadBody = Record<string, unknown> & { threadId: string };

export async function readThreadBody(req: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export const hasThreadId = (body: Record<string, unknown> | null): body is ThreadBody => typeof body?.threadId === "string";
