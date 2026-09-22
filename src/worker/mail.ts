import type {
  GrantView,
  MailRequestView,
  PublicProfile,
  RouletteMatchView,
  SealedEnvelope,
} from "../shared/types";
import { cleanText, validCountry } from "../shared/validation";
import type { Env } from "./context";
import { audit, notify, requireUser } from "./context";
import { HttpError, body, json } from "./http";
import { id, isoAfter, parseJson } from "./security";

function sealed(value: unknown): value is SealedEnvelope {
  const envelope = value as Partial<SealedEnvelope> | null;
  return Boolean(
    envelope &&
    envelope.version === 1 &&
    envelope.algorithm === "AES-256-GCM" &&
    envelope.keyAgreement === "X25519-HKDF-SHA256" &&
    typeof envelope.iv === "string" &&
    typeof envelope.ciphertext === "string" &&
    typeof envelope.ephemeralPublicKey === "string",
  );
}

async function assertMemberAvailable(
  env: Env,
  senderId: string,
  recipientId: string,
): Promise<void> {
  if (senderId === recipientId)
    throw new HttpError(400, "Choose another member.");
  const target = await env.DB.prepare(
    "SELECT 1 FROM users WHERE id = ? AND status = 'active'",
  )
    .bind(recipientId)
    .first();
  if (!target) throw new HttpError(404, "That member is unavailable.");
  const blocked = await env.DB.prepare(
    `SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
  )
    .bind(senderId, recipientId, recipientId, senderId)
    .first();
  if (blocked)
    throw new HttpError(403, "Mail requests are unavailable for this member.");
}

export async function createRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    recipientId?: string;
    encryptedNote?: SealedEnvelope | null;
  }>(request);
  const recipientId = cleanText(input.recipientId, 80);
  await assertMemberAvailable(env, user.id, recipientId);
  if (input.encryptedNote && !sealed(input.encryptedNote))
    throw new HttpError(400, "Invalid encrypted note.");
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM mail_requests
     WHERE sender_id = ? AND created_at >= datetime('now', '-7 days')`,
  )
    .bind(user.id)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= 5)
    throw new HttpError(429, "You can send five targeted requests per week.");
  const duplicate = await env.DB.prepare(
    "SELECT 1 FROM mail_requests WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'",
  )
    .bind(user.id, recipientId)
    .first();
  if (duplicate)
    throw new HttpError(409, "A request to this member is already pending.");
  const requestId = id("req");
  await env.DB.prepare(
    `INSERT INTO mail_requests (id, sender_id, recipient_id, encrypted_note_json, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      requestId,
      user.id,
      recipientId,
      input.encryptedNote ? JSON.stringify(input.encryptedNote) : null,
      isoAfter(7 * 24 * 60 * 60_000),
    )
    .run();
  await audit(env, user.id, "mail_request.created", "mail_request", requestId, {
    recipientId,
  });
  await notify(
    env,
    recipientId,
    "A mail request is waiting",
    "A verified member sent you a mail request. No private details are included in this email.",
  );
  return json({ id: requestId }, { status: 201 });
}

export async function listRequests(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT r.*, u.id AS member_id, u.username, u.display_name, u.bio, u.country_code, u.public_encryption_key,
            CASE WHEN r.recipient_id = ? THEN 'incoming' ELSE 'outgoing' END AS direction
     FROM mail_requests r
     JOIN users u ON u.id = CASE WHEN r.recipient_id = ? THEN r.sender_id ELSE r.recipient_id END
     WHERE r.sender_id = ? OR r.recipient_id = ?
     ORDER BY r.created_at DESC LIMIT 80`,
  )
    .bind(user.id, user.id, user.id, user.id)
    .all<Record<string, string | null>>();
  const requests: MailRequestView[] = rows.results.map((row) => ({
    id: String(row.id),
    direction: row.direction as "incoming" | "outgoing",
    status: String(row.status),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    encryptedNote: parseJson<SealedEnvelope | null>(
      row.encrypted_note_json,
      null,
    ),
    member: {
      id: String(row.member_id),
      username: String(row.username),
      displayName: row.display_name ?? null,
      bio: row.bio ?? null,
      countryCode: row.country_code ?? null,
      publicEncryptionKey: String(row.public_encryption_key),
    },
  }));
  return json({ requests });
}

export async function decideRequest(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    decision?: "approve" | "deny";
    encryptedAddress?: SealedEnvelope;
  }>(request);
  const row = await env.DB.prepare(
    "SELECT id, sender_id, recipient_id, status, expires_at FROM mail_requests WHERE id = ? AND recipient_id = ?",
  )
    .bind(requestId, user.id)
    .first<{
      id: string;
      sender_id: string;
      recipient_id: string;
      status: string;
      expires_at: string;
    }>();
  if (!row || row.status !== "pending")
    throw new HttpError(404, "Pending request not found.");
  if (row.expires_at <= new Date().toISOString())
    throw new HttpError(410, "This request expired.");
  if (input.decision === "deny") {
    await env.DB.prepare(
      "UPDATE mail_requests SET status = 'denied', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
      .bind(requestId)
      .run();
    await audit(env, user.id, "mail_request.denied", "mail_request", requestId);
    return json({ ok: true });
  }
  if (input.decision !== "approve" || !sealed(input.encryptedAddress))
    throw new HttpError(400, "An encrypted address is required.");
  const grantId = id("grant");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE mail_requests SET status = 'approved', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    ).bind(requestId),
    env.DB.prepare(
      `INSERT INTO address_grants
       (id, sender_id, recipient_id, source_type, source_id, encrypted_address_json, expires_at)
       VALUES (?, ?, ?, 'targeted', ?, ?, ?)`,
    ).bind(
      grantId,
      row.sender_id,
      user.id,
      requestId,
      JSON.stringify(input.encryptedAddress),
      isoAfter(14 * 24 * 60 * 60_000),
    ),
  ]);
  await audit(
    env,
    user.id,
    "mail_request.approved",
    "mail_request",
    requestId,
    { grantId },
  );
  return json({ ok: true, grantId });
}

export async function createRoulette(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    anonymous?: boolean;
    destinationCountries?: string[];
  }>(request);
  const countries = (input.destinationCountries ?? [])
    .map((country) => country.toUpperCase())
    .filter(validCountry)
    .slice(0, 40);
  const open = await env.DB.prepare(
    "SELECT 1 FROM roulette_matches WHERE sender_id = ? AND status IN ('pending_release', 'released')",
  )
    .bind(user.id)
    .first();
  if (open)
    throw new HttpError(
      409,
      "Finish your current roulette mailing before drawing again.",
    );
  const params: unknown[] = [
    user.id,
    input.anonymous ? 1 : 0,
    user.id,
    user.id,
    user.id,
    user.id,
  ];
  const countryClause = countries.length
    ? `AND u.country_code IN (${countries.map(() => "?").join(",")})`
    : "";
  params.push(...countries);
  const target = await env.DB.prepare(
    `SELECT u.id, u.public_encryption_key
     FROM users u JOIN mail_settings s ON s.user_id = u.id JOIN address_vaults v ON v.user_id = u.id
     WHERE u.status = 'active' AND u.id <> ? AND s.roulette_enabled = 1 AND s.paused = 0
       AND (? = 0 OR s.anonymous_enabled = 1)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
         (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       AND NOT EXISTS (SELECT 1 FROM roulette_matches old WHERE
         old.created_at >= datetime('now', '-90 days') AND
         ((old.sender_id = ? AND old.recipient_id = u.id) OR (old.sender_id = u.id AND old.recipient_id = ?)))
       AND (SELECT COUNT(*) FROM roulette_matches current WHERE current.recipient_id = u.id
         AND current.created_at >= datetime('now', '-30 days')) < s.monthly_limit
       ${countryClause}
     ORDER BY RANDOM() LIMIT 1`,
  )
    .bind(...params)
    .first<{ id: string; public_encryption_key: string }>();
  if (!target)
    throw new HttpError(
      404,
      "No eligible roulette recipient is available right now. Try another destination or come back later.",
    );
  const matchId = id("match");
  await env.DB.prepare(
    `INSERT INTO roulette_matches (id, sender_id, recipient_id, anonymous, release_expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      matchId,
      user.id,
      target.id,
      input.anonymous ? 1 : 0,
      isoAfter(7 * 24 * 60 * 60_000),
    )
    .run();
  await audit(env, user.id, "roulette.created", "roulette_match", matchId, {
    anonymous: Boolean(input.anonymous),
  });
  await notify(
    env,
    target.id,
    "Mail roulette is waiting",
    "Your opted-in roulette match is ready to release the next time you unlock your vault.",
  );
  return json({ id: matchId, status: "pending_release" }, { status: 201 });
}

export async function releaseRoulette(
  request: Request,
  env: Env,
  matchId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{ encryptedAddress?: SealedEnvelope }>(request);
  if (!sealed(input.encryptedAddress))
    throw new HttpError(400, "An encrypted address is required.");
  const match = await env.DB.prepare(
    "SELECT sender_id, status, release_expires_at FROM roulette_matches WHERE id = ? AND recipient_id = ?",
  )
    .bind(matchId, user.id)
    .first<{ sender_id: string; status: string; release_expires_at: string }>();
  if (!match || match.status !== "pending_release")
    throw new HttpError(404, "Pending roulette match not found.");
  if (match.release_expires_at <= new Date().toISOString())
    throw new HttpError(410, "This match expired.");
  const grantId = id("grant");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE roulette_matches SET status = 'released', released_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(matchId),
    env.DB.prepare(
      `INSERT INTO address_grants
       (id, sender_id, recipient_id, source_type, source_id, encrypted_address_json, expires_at)
       VALUES (?, ?, ?, 'roulette', ?, ?, ?)`,
    ).bind(
      grantId,
      match.sender_id,
      user.id,
      matchId,
      JSON.stringify(input.encryptedAddress),
      isoAfter(14 * 24 * 60 * 60_000),
    ),
  ]);
  await audit(env, user.id, "roulette.released", "roulette_match", matchId, {
    grantId,
  });
  return json({ ok: true, grantId });
}

export async function listRoulette(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT m.*, u.id AS member_id, u.username, u.display_name, u.bio, u.country_code, u.public_encryption_key,
       CASE WHEN m.recipient_id = ? THEN 'incoming' ELSE 'outgoing' END AS direction
     FROM roulette_matches m
     JOIN users u ON u.id = CASE WHEN m.recipient_id = ? THEN m.sender_id ELSE m.recipient_id END
     WHERE m.sender_id = ? OR m.recipient_id = ? ORDER BY m.created_at DESC LIMIT 80`,
  )
    .bind(user.id, user.id, user.id, user.id)
    .all<Record<string, string | number | null>>();
  const matches: RouletteMatchView[] = rows.results.map((row) => {
    const incomingAnonymous =
      row.direction === "incoming" && Boolean(row.anonymous);
    const member: PublicProfile | null = incomingAnonymous
      ? null
      : {
          id: String(row.member_id),
          username: String(row.username),
          displayName:
            row.display_name === null ? null : String(row.display_name),
          bio: row.bio === null ? null : String(row.bio),
          countryCode:
            row.country_code === null ? null : String(row.country_code),
          publicEncryptionKey: String(row.public_encryption_key),
        };
    return {
      id: String(row.id),
      direction: row.direction as "incoming" | "outgoing",
      anonymous: Boolean(row.anonymous),
      status: String(row.status),
      createdAt: String(row.created_at),
      releaseExpiresAt: String(row.release_expires_at),
      member,
      ...(row.direction === "incoming" && row.status === "pending_release"
        ? { releasePublicKey: String(row.public_encryption_key) }
        : {}),
    };
  });
  return json({ matches });
}

export async function listGrants(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT g.id, g.source_type, g.status, g.expires_at, g.encrypted_address_json, u.username, u.display_name
     FROM address_grants g JOIN users u ON u.id = g.recipient_id
     WHERE g.sender_id = ? AND g.status IN ('active', 'sent')
     ORDER BY g.created_at DESC`,
  )
    .bind(user.id)
    .all<Record<string, string | null>>();
  const grants: GrantView[] = rows.results.map((row) => ({
    id: String(row.id),
    recipient: {
      username: String(row.username),
      displayName: row.display_name ?? null,
    },
    sourceType: row.source_type as "targeted" | "roulette",
    status: String(row.status),
    expiresAt: String(row.expires_at),
    encryptedAddress: parseJson<SealedEnvelope>(
      row.encrypted_address_json,
      null as never,
    ),
  }));
  return json({ grants });
}

export async function markGrantSent(
  request: Request,
  env: Env,
  grantId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  const grant = await env.DB.prepare(
    "SELECT source_type, source_id FROM address_grants WHERE id = ? AND sender_id = ? AND status = 'active'",
  )
    .bind(grantId, user.id)
    .first<{ source_type: string; source_id: string }>();
  if (!grant) throw new HttpError(404, "Active address grant not found.");
  const statements = [
    env.DB.prepare(
      `UPDATE address_grants SET status = 'sent', sent_at = CURRENT_TIMESTAMP, encrypted_address_json = '{}'
     WHERE id = ? AND sender_id = ? AND status = 'active'`,
    ).bind(grantId, user.id),
  ];
  if (grant.source_type === "roulette") {
    statements.push(
      env.DB.prepare(
        "UPDATE roulette_matches SET status = 'completed' WHERE id = ? AND status = 'released'",
      ).bind(grant.source_id),
    );
  }
  await env.DB.batch(statements);
  await audit(env, user.id, "address_grant.sent", "address_grant", grantId);
  return json({ ok: true });
}

export async function createReport(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    matchId?: string;
    subjectUserId?: string;
    category?: string;
    details?: string;
  }>(request);
  const category = cleanText(input.category, 40);
  const details = cleanText(input.details, 2_000);
  if (!category) throw new HttpError(400, "Choose a report category.");
  let subjectUserId = cleanText(input.subjectUserId, 80) || null;
  const matchId = cleanText(input.matchId, 80) || null;
  if (matchId) {
    const match = await env.DB.prepare(
      "SELECT sender_id, recipient_id FROM roulette_matches WHERE id = ?",
    )
      .bind(matchId)
      .first<{
        sender_id: string;
        recipient_id: string;
      }>();
    if (!match || ![match.sender_id, match.recipient_id].includes(user.id))
      throw new HttpError(404, "Match not found.");
    subjectUserId =
      match.sender_id === user.id ? match.recipient_id : match.sender_id;
  }
  if (!subjectUserId) throw new HttpError(400, "A report subject is required.");
  const reportId = id("report");
  await env.DB.prepare(
    `INSERT INTO reports (id, reporter_id, subject_user_id, match_id, category, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(reportId, user.id, subjectUserId, matchId, category, details)
    .run();
  await audit(env, user.id, "report.created", "report", reportId, { matchId });
  return json({ id: reportId }, { status: 201 });
}
