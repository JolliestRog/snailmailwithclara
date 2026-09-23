import type { FeedbackKind, FeedbackView } from "../shared/types";
import { cleanText } from "../shared/validation";
import type { Env } from "./context";
import { audit, requireRole, requireUser } from "./context";
import { HttpError, body, json } from "./http";
import { id } from "./security";

interface FeedbackRow {
  id: string;
  user_id: string;
  username: string;
  kind: FeedbackKind;
  title: string;
  summary: string;
  steps: string;
  expected: string;
  actual: string;
  page_url: string;
  build_sha: string;
  status: FeedbackView["status"];
  n8n_status: FeedbackView["n8nStatus"];
  n8n_attempts: number;
  created_at: string;
}

function feedbackView(row: FeedbackRow): FeedbackView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    steps: row.steps,
    expected: row.expected,
    actual: row.actual,
    pageUrl: row.page_url,
    buildSha: row.build_sha,
    status: row.status,
    n8nStatus: row.n8n_status,
    createdAt: row.created_at,
    username: row.username,
  };
}

export async function createFeedback(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    kind?: FeedbackKind;
    title?: string;
    summary?: string;
    steps?: string;
    expected?: string;
    actual?: string;
    pageUrl?: string;
  }>(request);
  if (!input.kind || !["bug", "feature"].includes(input.kind))
    throw new HttpError(400, "Choose bug report or feature request.");
  const title = cleanText(input.title, 120);
  const summary = cleanText(input.summary, 2000);
  if (!title || !summary)
    throw new HttpError(400, "Add a short title and summary.");
  const feedbackId = id("feedback");
  await env.DB.prepare(
    `INSERT INTO feedback_items
      (id, user_id, kind, title, summary, steps, expected, actual, page_url, build_sha)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      feedbackId,
      user.id,
      input.kind,
      title,
      summary,
      cleanText(input.steps, 4000),
      cleanText(input.expected, 2000),
      cleanText(input.actual, 2000),
      cleanText(input.pageUrl, 500),
      env.BUILD_SHA,
    )
    .run();
  const forwarded = await dispatchFeedback(env, feedbackId);
  await audit(env, user.id, "feedback.created", "feedback", feedbackId, {
    kind: input.kind,
    forwarded,
  });
  return json({ feedbackId, forwarded }, { status: 201 });
}

export async function dispatchFeedback(
  env: Env,
  feedbackId: string,
): Promise<boolean> {
  if (!env.N8N_FEEDBACK_WEBHOOK_URL) return false;
  const row = await env.DB.prepare(
    `SELECT f.*, u.username
     FROM feedback_items f JOIN users u ON u.id = f.user_id
     WHERE f.id = ? AND f.n8n_status <> 'delivered' AND f.n8n_attempts < 5`,
  )
    .bind(feedbackId)
    .first<FeedbackRow>();
  if (!row) return false;
  try {
    const response = await fetch(env.N8N_FEEDBACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "snailmail.feedback.created",
        project: "snailmailwithclara",
        repository: env.REPOSITORY_URL,
        feedback: feedbackView(row),
      }),
    });
    if (!response.ok) throw new Error(`n8n returned ${response.status}.`);
    await env.DB.prepare(
      `UPDATE feedback_items SET n8n_status = 'delivered', n8n_attempts = n8n_attempts + 1,
       n8n_last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(feedbackId)
      .run();
    return true;
  } catch (error) {
    await env.DB.prepare(
      `UPDATE feedback_items SET n8n_status = 'failed', n8n_attempts = n8n_attempts + 1,
       n8n_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(
        cleanText(
          error instanceof Error ? error.message : "Unknown error",
          500,
        ),
        feedbackId,
      )
      .run();
    return false;
  }
}

export async function dispatchPendingFeedback(env: Env): Promise<void> {
  if (!env.N8N_FEEDBACK_WEBHOOK_URL) return;
  const pending = await env.DB.prepare(
    `SELECT id FROM feedback_items
     WHERE n8n_status IN ('pending', 'failed') AND n8n_attempts < 5
     ORDER BY created_at LIMIT 25`,
  ).all<{ id: string }>();
  for (const item of pending.results) await dispatchFeedback(env, item.id);
}

export async function listFeedback(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const rows = await env.DB.prepare(
    `SELECT f.*, u.username
     FROM feedback_items f JOIN users u ON u.id = f.user_id
     ORDER BY CASE f.status WHEN 'new' THEN 0 WHEN 'triaged' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
              f.created_at DESC LIMIT 100`,
  ).all<FeedbackRow>();
  return json({ feedback: rows.results.map(feedbackView) });
}

export async function updateFeedbackStatus(
  request: Request,
  env: Env,
  feedbackId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "moderator");
  const input = await body<{ status?: FeedbackView["status"] }>(request);
  if (
    !input.status ||
    !["new", "triaged", "planned", "closed"].includes(input.status)
  )
    throw new HttpError(400, "Choose a valid feedback status.");
  const result = await env.DB.prepare(
    "UPDATE feedback_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(input.status, feedbackId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Feedback not found.");
  await audit(env, user.id, "feedback.status_updated", "feedback", feedbackId, {
    status: input.status,
  });
  return json({ ok: true });
}
