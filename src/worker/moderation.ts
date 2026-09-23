import type { Role } from "../shared/types";
import { cleanText } from "../shared/validation";
import type { Env } from "./context";
import { audit, notify, requireRole, requireUser } from "./context";
import { HttpError, body, json } from "./http";
import { id, isoAfter, parseJson, randomToken, sha256 } from "./security";

export function invitationRolesFor(
  requestedRoles: unknown,
  canAssignPrivileged: boolean,
): Role[] {
  if (
    !Array.isArray(requestedRoles) ||
    requestedRoles.some(
      (role) =>
        typeof role !== "string" ||
        !["member", "moderator", "curator"].includes(role),
    )
  )
    throw new HttpError(
      400,
      "Invitation roles may include member, moderator, or curator.",
    );
  const roles = [...new Set<Role>(["member", ...(requestedRoles as Role[])])];
  if (
    roles.some((role) => role === "moderator" || role === "curator") &&
    !canAssignPrivileged
  )
    throw new HttpError(
      403,
      "Only the security administrator can create privileged invitations.",
    );
  return roles;
}

export async function pendingMembers(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const rows = await env.DB.prepare(
    `SELECT id, username, display_name, created_at, age_attested_at FROM users
     WHERE status = 'pending' ORDER BY created_at`,
  ).all();
  return json({ members: rows.results });
}

export async function decideMember(
  request: Request,
  env: Env,
  memberId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const input = await body<{ decision?: "approve" | "deny" }>(request);
  const pending = await env.DB.prepare(
    "SELECT 1 FROM users WHERE id = ? AND status = 'pending'",
  )
    .bind(memberId)
    .first();
  if (!pending) throw new HttpError(404, "Pending member not found.");
  if (input.decision === "approve") {
    await env.DB.prepare(
      "UPDATE users SET status = 'active', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?",
    )
      .bind(user.id, memberId)
      .run();
    await audit(env, user.id, "member.approved", "user", memberId);
    await notify(
      env,
      memberId,
      "Your membership is approved",
      "Your Snail Mail with Clara account is ready.",
    );
  } else if (input.decision === "deny") {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET status = 'deleted', username = 'denied-' || id, display_name = NULL, bio = NULL,
         email = NULL, public_encryption_key = '', encrypted_private_key_json = '{}',
         recovery_wrapped_master_key_json = '{}', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(memberId),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(memberId),
    ]);
    await audit(env, user.id, "member.denied", "user", memberId);
  } else {
    throw new HttpError(400, "Choose approve or deny.");
  }
  return json({ ok: true });
}

export async function createInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const input = await body<{
    expiresInDays?: number;
    count?: number;
    roles?: Role[];
  }>(request);
  const requestedDays = Number(input.expiresInDays ?? 7);
  if (!Number.isInteger(requestedDays))
    throw new HttpError(400, "Choose a whole number of days.");
  const days = Math.min(30, Math.max(1, requestedDays));
  const count = Number(input.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new HttpError(400, "Create between 1 and 50 invitations.");
  const roles = invitationRolesFor(
    input.roles ?? ["member"],
    user.roles.includes("security_admin"),
  );
  const expiresAt = isoAfter(days * 24 * 60 * 60_000);
  const invitations = await Promise.all(
    Array.from({ length: count }, async () => {
      const token = randomToken(24);
      return {
        invitationId: id("invite"),
        token,
        tokenHash: await sha256(token),
      };
    }),
  );
  await env.DB.batch(
    invitations.map((invitation) =>
      env.DB.prepare(
        "INSERT INTO invitations (id, token_hash, created_by, roles_json, expires_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(
        invitation.invitationId,
        invitation.tokenHash,
        user.id,
        JSON.stringify(roles),
        expiresAt,
      ),
    ),
  );
  await audit(
    env,
    user.id,
    "invitation.batch_created",
    "invitation_batch",
    null,
    {
      days,
      count,
      roles,
      invitationIds: invitations.map((invitation) => invitation.invitationId),
    },
  );
  return json(
    {
      invitations: invitations.map(({ invitationId, token }) => ({
        invitationId,
        token,
        expiresAt,
      })),
    },
    { status: 201 },
  );
}

export async function createRecoveryInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const moderator = await requireUser(request, env);
  requireRole(moderator, "moderator");
  const input = await body<{ username?: string }>(request);
  const username = cleanText(input.username, 24).toLowerCase();
  const member = await env.DB.prepare(
    "SELECT id FROM users WHERE username = ? AND status = 'active'",
  )
    .bind(username)
    .first<{ id: string }>();
  if (!member)
    throw new HttpError(
      404,
      "Active member not found. Re-verify the username before issuing recovery.",
    );
  const token = randomToken(32);
  const recoveryId = id("recovery");
  const expiresAt = isoAfter(30 * 60_000);
  await env.DB.prepare(
    "INSERT INTO recovery_invitations (id, token_hash, user_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(recoveryId, await sha256(token), member.id, moderator.id, expiresAt)
    .run();
  await audit(
    env,
    moderator.id,
    "account_recovery.authorized",
    "user",
    member.id,
    { recoveryId },
  );
  return json({ token, username, expiresAt }, { status: 201 });
}

export async function listReports(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const rows = await env.DB.prepare(
    `SELECT r.id, r.category, r.details, r.status, r.created_at, r.match_id,
            reporter.username AS reporter_username, subject.username AS subject_username, subject.id AS subject_id
     FROM reports r JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users subject ON subject.id = r.subject_user_id
     WHERE r.status IN ('open', 'reviewing') ORDER BY r.created_at`,
  ).all();
  await audit(env, user.id, "reports.viewed", "report_queue", null, {
    count: rows.results.length,
  });
  return json({ reports: rows.results });
}

export async function resolveReport(
  request: Request,
  env: Env,
  reportId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const input = await body<{
    status?: "reviewing" | "resolved" | "dismissed";
    suspendSubject?: boolean;
  }>(request);
  if (
    !input.status ||
    !["reviewing", "resolved", "dismissed"].includes(input.status)
  )
    throw new HttpError(400, "Invalid report status.");
  const report = await env.DB.prepare(
    "SELECT subject_user_id FROM reports WHERE id = ?",
  )
    .bind(reportId)
    .first<{
      subject_user_id: string | null;
    }>();
  if (!report) throw new HttpError(404, "Report not found.");
  const statements = [
    env.DB.prepare(
      `UPDATE reports SET status = ?, resolved_at = CASE WHEN ? IN ('resolved', 'dismissed') THEN CURRENT_TIMESTAMP ELSE NULL END,
       resolved_by = ? WHERE id = ?`,
    ).bind(input.status, input.status, user.id, reportId),
  ];
  if (input.suspendSubject && report.subject_user_id) {
    statements.push(
      env.DB.prepare(
        "UPDATE users SET status = 'suspended' WHERE id = ? AND status = 'active'",
      ).bind(report.subject_user_id),
    );
    statements.push(
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(
        report.subject_user_id,
      ),
    );
  }
  await env.DB.batch(statements);
  await audit(env, user.id, "report.updated", "report", reportId, {
    status: input.status,
    suspended: Boolean(input.suspendSubject),
  });
  return json({ ok: true });
}

export async function auditLog(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const rows = await env.DB.prepare(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata_json, a.created_at, u.username AS actor
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 100`,
  ).all<Record<string, string | null>>();
  return json({
    events: rows.results.map((row) => ({
      ...row,
      metadata: parseJson(row.metadata_json, {}),
      metadata_json: undefined,
    })),
  });
}

export async function updateRoles(
  request: Request,
  env: Env,
  memberId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "security_admin");
  const input = await body<{ roles?: Role[] }>(request);
  const roles = [...new Set(input.roles ?? [])].filter((role): role is Role =>
    ["member", "moderator", "curator", "security_admin"].includes(role),
  );
  if (!roles.includes("member")) roles.unshift("member");
  await env.DB.prepare("UPDATE users SET roles_json = ? WHERE id = ?")
    .bind(JSON.stringify(roles), memberId)
    .run();
  await audit(env, user.id, "member.roles_updated", "user", memberId, {
    roles,
  });
  return json({ ok: true });
}

export async function suspendMember(
  request: Request,
  env: Env,
  memberId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  if (user.id === memberId)
    throw new HttpError(400, "You cannot suspend your own account.");
  const input = await body<{ suspended?: boolean; reason?: string }>(request);
  const status = input.suspended ? "suspended" : "active";
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET status = ? WHERE id = ? AND status IN ('active', 'suspended')",
    ).bind(status, memberId),
    ...(input.suspended
      ? [
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(
            memberId,
          ),
        ]
      : []),
  ]);
  await audit(
    env,
    user.id,
    input.suspended ? "member.suspended" : "member.reactivated",
    "user",
    memberId,
    {
      reason: cleanText(input.reason, 500),
    },
  );
  return json({ ok: true });
}
