export type ActionFailure = { ok: false; status: number; error: string; message: string };
export type ActionResult<T> = { ok: true; data: T } | ActionFailure;

export const failure = (status: number, error: string, message: string): ActionFailure => ({ ok: false, status, error, message });

export async function runAction<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch {
    return failure(0, "network", "Couldn't reach the server. Check your connection and try again.");
  }
}
