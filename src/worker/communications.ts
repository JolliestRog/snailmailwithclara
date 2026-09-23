import type { AccountMessage, AnnouncementKind, Role } from "../shared/types";
import { cleanText } from "../shared/validation";
import type { Env } from "./context";
import { audit, requireRole, requireUser } from "./context";
import { HttpError, body, json } from "./http";
import { id } from "./security";

interface MessageRow {
  id: string;
  source: AccountMessage["source"];
  kind: AccountMessage["kind"];
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  author: string | null;
}

interface DeliveryRow {
  announcement_id: string;
  user_id: string;
  email: string;
  subject: string;
  body: string;
  kind: AnnouncementKind;
}

export function canPublishAnnouncement(
  roles: Role[],
  kind: AnnouncementKind,
): boolean {
  if (roles.includes("security_admin")) return true;
  return kind === "newsletter"
    ? roles.includes("curator")
    : roles.includes("moderator");
}

export function welcomeMessageFor(roles: Role[]): {
  title: string;
  body: string;
} {
  const sections = [
    "Welcome to the live beta. Start in Address vault: enter the mailing label you want approved senders to use, then choose Encrypt and save address. The server receives encrypted address data, not the readable label.",
    "Keep your recovery code somewhere private. It unlocks your encrypted vault on a new browser; moderators cannot retrieve it for you. In Settings, choose whether to join roulette and whether you want email alerts or Clara's newsletters.",
    "People can request to mail you from the People page. Nothing shares your address until you approve a request. Use Inbox to review requests and mailing labels.",
  ];
  if (roles.includes("moderator"))
    sections.push(
      "Moderator tools: Moderation shows pending members, reports, recovery links, and invitation batches. Verify people outside the app before approval. Never ask for an address or recovery code. Moderator invitations do not grant security administrator access.",
    );
  if (roles.includes("curator"))
    sections.push(
      "Curator tools: Clara's page lets you edit a draft, preview it, publish it, and roll back revisions. Updates lets you compose newsletters for members who explicitly opted in.",
    );
  return { title: "Welcome — start here", body: sections.join("\n\n") };
}

export async function listMessages(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const [personal, announcements] = await Promise.all([
    env.DB.prepare(
      `SELECT id, 'personal' AS source, kind, title, body, created_at, read_at, NULL AS author
       FROM member_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<MessageRow>(),
    env.DB.prepare(
      `SELECT a.id, 'announcement' AS source, a.kind, a.subject AS title, a.body,
              a.created_at, ar.read_at, u.username AS author
       FROM announcement_recipients ar
       JOIN announcements a ON a.id = ar.announcement_id
       JOIN users u ON u.id = a.author_id
       WHERE ar.user_id = ? ORDER BY a.created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<MessageRow>(),
  ]);
  const messages = [...personal.results, ...announcements.results]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 75)
    .map((row): AccountMessage => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      readAt: row.read_at,
      author: row.author,
    }));
  return json({ messages });
}

export async function markMessageRead(
  request: Request,
  env: Env,
  source: string,
  messageId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  if (source === "personal") {
    await env.DB.prepare(
      "UPDATE member_messages SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
    )
      .bind(messageId, user.id)
      .run();
  } else if (source === "announcement") {
    await env.DB.prepare(
      "UPDATE announcement_recipients SET read_at = CURRENT_TIMESTAMP WHERE announcement_id = ? AND user_id = ?",
    )
      .bind(messageId, user.id)
      .run();
  } else {
    throw new HttpError(400, "Unknown message source.");
  }
  return json({ ok: true });
}

export async function createAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    kind?: AnnouncementKind;
    subject?: string;
    message?: string;
  }>(request);
  if (!input.kind || !["newsletter", "update", "warning"].includes(input.kind))
    throw new HttpError(400, "Choose newsletter, update, or warning.");
  if (!canPublishAnnouncement(user.roles, input.kind))
    throw new HttpError(403, "You do not have permission to send that update.");
  const subject = cleanText(input.subject, 120);
  const message = cleanText(input.message, 8000);
  if (!subject || !message)
    throw new HttpError(400, "Add both a subject and a message.");
  const announcementId = id("announcement");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO announcements (id, author_id, kind, subject, body) VALUES (?, ?, ?, ?, ?)",
    ).bind(announcementId, user.id, input.kind, subject, message),
    env.DB.prepare(
      `INSERT INTO announcement_recipients (announcement_id, user_id, email_status)
       SELECT ?, id,
         CASE
           WHEN email IS NOT NULL AND (
             (? = 'newsletter' AND newsletter_opt_in = 1) OR
             (? <> 'newsletter' AND email_notifications = 1)
           ) THEN 'pending'
           ELSE 'none'
         END
       FROM users
       WHERE status = 'active' AND (? <> 'newsletter' OR newsletter_opt_in = 1)`,
    ).bind(announcementId, input.kind, input.kind, input.kind),
  ]);
  const email = await dispatchAnnouncementEmails(env, announcementId);
  await audit(
    env,
    user.id,
    "announcement.created",
    "announcement",
    announcementId,
    {
      kind: input.kind,
      email,
    },
  );
  return json({ announcementId, email }, { status: 201 });
}

export async function dispatchAnnouncementEmails(
  env: Env,
  announcementId?: string,
): Promise<{ attempted: number; sent: number; configured: boolean }> {
  if (!env.RESEND_API_KEY) return { attempted: 0, sent: 0, configured: false };
  const condition = announcementId
    ? "ar.email_status IN ('pending', 'failed') AND ar.email_attempts < 3 AND ar.announcement_id = ?"
    : "ar.email_status IN ('pending', 'failed') AND ar.email_attempts < 3";
  const statement = env.DB.prepare(
    `SELECT ar.announcement_id, ar.user_id, u.email, a.subject, a.body, a.kind
     FROM announcement_recipients ar
     JOIN announcements a ON a.id = ar.announcement_id
     JOIN users u ON u.id = ar.user_id
     WHERE ${condition} AND u.email IS NOT NULL
     ORDER BY a.created_at LIMIT 100`,
  );
  const rows = announcementId
    ? await statement.bind(announcementId).all<DeliveryRow>()
    : await statement.all<DeliveryRow>();
  if (!rows.results.length) return { attempted: 0, sent: 0, configured: true };
  const payload = rows.results.map((row) => ({
    from: env.RESEND_FROM ?? env.NOTIFY_FROM,
    to: [row.email],
    subject: row.subject,
    text: `${row.body}\n\nOpen ${env.ORIGIN}/app\n\n${
      row.kind === "newsletter"
        ? "You opted in to Clara's newsletters. Change this in Settings."
        : "You enabled generic email alerts. Change this in Settings."
    }`,
    tags: [
      { name: "source", value: "snailmailwithclara" },
      { name: "kind", value: row.kind },
    ],
  }));
  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error =
      cleanText(await response.text(), 500) || `HTTP ${response.status}`;
    await env.DB.batch(
      rows.results.map((row) =>
        env.DB.prepare(
          `UPDATE announcement_recipients
           SET email_status = 'failed', email_attempts = email_attempts + 1, email_error = ?
           WHERE announcement_id = ? AND user_id = ?`,
        ).bind(error, row.announcement_id, row.user_id),
      ),
    );
    return { attempted: rows.results.length, sent: 0, configured: true };
  }
  const result = (await response.json()) as { data?: Array<{ id?: string }> };
  await env.DB.batch(
    rows.results.map((row, index) =>
      env.DB.prepare(
        `UPDATE announcement_recipients
         SET email_status = 'sent', email_attempts = email_attempts + 1,
             email_error = NULL, resend_id = ?
         WHERE announcement_id = ? AND user_id = ?`,
      ).bind(
        result.data?.[index]?.id ?? null,
        row.announcement_id,
        row.user_id,
      ),
    ),
  );
  return {
    attempted: rows.results.length,
    sent: rows.results.length,
    configured: true,
  };
}

export async function retryAnnouncementEmails(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const result = await dispatchAnnouncementEmails(env);
  await audit(
    env,
    user.id,
    "announcement.email_retry",
    "announcement",
    null,
    result,
  );
  return json(result);
}
