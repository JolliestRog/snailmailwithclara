import type { ApiErrorShape } from "../shared/types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      { error: error.message, code: error.code } satisfies ApiErrorShape,
      { status: error.status },
    );
  }
  console.error(
    "request_failed",
    error instanceof Error
      ? { name: error.name, message: error.message }
      : "unknown",
  );
  return json({ error: "Something went wrong." } satisfies ApiErrorShape, {
    status: 500,
  });
}

export async function body<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new HttpError(415, "Expected JSON.");
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export function assertSameOrigin(request: Request, origin: string): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  if (request.headers.get("origin") !== origin)
    throw new HttpError(403, "Origin check failed.");
}

export function cookie(request: Request, name: string): string | null {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : null;
}

export function sessionCookie(
  token: string,
  maxAge = 60 * 60 * 24 * 14,
): string {
  return `smwc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return "smwc_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
