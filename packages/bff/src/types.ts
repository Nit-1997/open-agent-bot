export type AuthOutcome =
  | { ok: true; headers: Readonly<Record<string, string>> }
  | { ok: false; status: 401 | 503; error: "signed_out" | "auth_unavailable"; message: string };

export type BffDeps = Readonly<{
  agentUrl: string;
  appOrigin: string | readonly string[] | ((origin: string) => boolean);
  allowedHosts?: readonly string[];
  auth: (req: Request) => Promise<AuthOutcome>;
  fetch?: typeof fetch;
  basePath?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
}>;

export type BffHandler = (req: Request) => Promise<Response>;

export type BffContext = Readonly<{
  agentUrl: string;
  appOrigin: BffDeps["appOrigin"];
  allowedHosts: ReadonlySet<string> | null;
  auth: BffDeps["auth"];
  fetch: typeof fetch;
  basePath: string;
  timeoutMs: number;
  maxBodyBytes: number;
}>;
