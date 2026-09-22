import type { ApiErrorShape } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const data = (await response
    .json()
    .catch(() => ({ error: "Unexpected server response." }))) as T &
    ApiErrorShape;
  if (!response.ok)
    throw new ApiError(
      data.error || "Request failed.",
      response.status,
      data.code,
    );
  return data;
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
