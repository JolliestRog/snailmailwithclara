import type { Role } from "../shared/types";
import { HttpError, cookie } from "./http";
import { parseJson, sha256 } from "./security";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  RP_NAME: string;
  RP_ID: string;
  ORIGIN: string;
  BUILD_SHA: string;
  NOTIFY_FROM: string;
  REPOSITORY_URL: string;
  BOOTSTRAP_TOKEN_HASH?: string;
  BOOTSTRAP_USERNAME?: string;
  EMAIL?: {
    send(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<void>;
  };
}

export async function notify(
  env: Env,
  userId: string,
  subject: string,
  text: string,
): Promise<void> {
  if (!env.EMAIL) return;
  const recipient = await env.DB.prepare(
    "SELECT email FROM users WHERE id = ? AND status = 'active' AND email_notifications = 1 AND email IS NOT NULL",
  )
    .bind(userId)
    .first<{ email: string }>();
  if (!recipient) return;
  try {
    await env.EMAIL.send({
      from: env.NOTIFY_FROM,
      to: recipient.email,
      subject,
      text: `${text}\n\nOpen ${env.ORIGIN}/app`,
    });
  } catch (error) {
    console.error(
      "notification_delivery_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
}

export interface AuthUser {
  id: string;
  username: string;
  status: string;
  roles: Role[];
}

interface SessionRow {
  id: string;
  username: string;
  status: string;
  roles_json: string;
}

export async function optionalUser(
  request: Request,
  env: Env,
): Promise<AuthUser | null> {
  const token = cookie(request, "smwc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.status, u.roles_json
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP`,
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row || row.status === "deleted") return null;
  return {
    id: row.id,
    username: row.username,
    status: row.status,
    roles: parseJson<Role[]>(row.roles_json, ["member"]),
  };
}

export async function requireUser(
  request: Request,
  env: Env,
): Promise<AuthUser> {
  const user = await optionalUser(request, env);
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.status === "pending")
    throw new HttpError(
      403,
      "Your membership is waiting for moderator approval.",
      "PENDING",
    );
  if (user.status !== "active")
    throw new HttpError(403, "This account is not active.");
  return user;
}

export function requireRole(user: AuthUser, role: Role): void {
  if (!user.roles.includes(role) && !user.roles.includes("security_admin")) {
    throw new HttpError(403, "You do not have permission to do that.");
  }
}

export async function audit(
  env: Env,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      targetType,
      targetId,
      JSON.stringify(metadata),
    )
    .run();
}
