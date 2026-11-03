import { type ApiErrorBody, apiErrorMessage } from "./apiErrors.ts";
import { noteAuthFailure } from "./authState.ts";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readApi<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    noteAuthFailure(res.status, body.error);
    throw new ApiError(res.status, typeof body.error === "string" ? body.error : "", apiErrorMessage(res.status, body));
  }
  return body;
}
