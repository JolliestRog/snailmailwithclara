import type { LandingContent } from "../shared/types";
import { validLandingContent } from "../shared/validation";
import type { Env } from "./context";
import { audit, requireRole, requireUser } from "./context";
import { HttpError, body, json } from "./http";
import { id, parseJson } from "./security";

interface RevisionRow {
  id: string;
  content_json: string;
  created_at: string;
  published_at: string | null;
  is_draft: number;
}

export async function publicLanding(
  _request: Request,
  env: Env,
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT r.id, r.content_json, r.created_at, r.published_at, r.is_draft
     FROM landing_revisions r JOIN app_settings s ON s.value = r.id
     WHERE s.key = 'published_landing_revision'`,
  ).first<RevisionRow>();
  if (!row) throw new HttpError(500, "Landing page is not configured.");
  return json(
    {
      revisionId: row.id,
      content: parseJson<LandingContent>(row.content_json, {
        theme: "signal-red",
        blocks: [],
      }),
      publishedAt: row.published_at,
      buildSha: env.BUILD_SHA,
      repositoryUrl: env.REPOSITORY_URL,
    },
    {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}

export async function getCuration(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "curator");
  const draft = await env.DB.prepare(
    "SELECT * FROM landing_revisions WHERE is_draft = 1 ORDER BY created_at DESC LIMIT 1",
  ).first<RevisionRow>();
  const published = await env.DB.prepare(
    `SELECT r.* FROM landing_revisions r JOIN app_settings s ON s.value = r.id
     WHERE s.key = 'published_landing_revision'`,
  ).first<RevisionRow>();
  const view = (row: RevisionRow | null) =>
    row
      ? {
          id: row.id,
          content: parseJson(row.content_json, null),
          createdAt: row.created_at,
          publishedAt: row.published_at,
        }
      : null;
  return json({ draft: view(draft), published: view(published) });
}

export async function saveDraft(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "curator");
  const input = await body<{ content?: LandingContent }>(request);
  if (!validLandingContent(input.content))
    throw new HttpError(
      400,
      "The page contains an invalid or unsupported block.",
    );
  const existing = await env.DB.prepare(
    "SELECT id FROM landing_revisions WHERE is_draft = 1 ORDER BY created_at DESC LIMIT 1",
  ).first<{
    id: string;
  }>();
  const revisionId = existing?.id ?? id("page");
  if (existing) {
    await env.DB.prepare(
      "UPDATE landing_revisions SET content_json = ?, created_by = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
      .bind(JSON.stringify(input.content), user.id, revisionId)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO landing_revisions (id, content_json, created_by) VALUES (?, ?, ?)",
    )
      .bind(revisionId, JSON.stringify(input.content), user.id)
      .run();
  }
  return json({ ok: true, revisionId });
}

export async function publishDraft(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "curator");
  const input = await body<{ revisionId?: string }>(request);
  const revision = await env.DB.prepare(
    "SELECT id FROM landing_revisions WHERE id = ? AND is_draft = 1",
  )
    .bind(input.revisionId ?? "")
    .first<{ id: string }>();
  if (!revision) throw new HttpError(404, "Draft not found.");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE landing_revisions SET is_draft = 0, published_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(revision.id),
    env.DB.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('published_landing_revision', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(revision.id),
  ]);
  await audit(
    env,
    user.id,
    "landing.published",
    "landing_revision",
    revision.id,
  );
  return json({ ok: true, revisionId: revision.id });
}

export async function listRevisions(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "curator");
  const rows = await env.DB.prepare(
    `SELECT r.id, r.created_at, r.published_at, u.username
     FROM landing_revisions r LEFT JOIN users u ON u.id = r.created_by
     WHERE r.is_draft = 0 ORDER BY r.published_at DESC LIMIT 25`,
  ).all();
  return json({ revisions: rows.results });
}

export async function rollbackRevision(
  request: Request,
  env: Env,
  revisionId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "curator");
  const source = await env.DB.prepare(
    "SELECT content_json FROM landing_revisions WHERE id = ? AND is_draft = 0",
  )
    .bind(revisionId)
    .first<{ content_json: string }>();
  if (!source) throw new HttpError(404, "Published revision not found.");
  const nextId = id("page");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO landing_revisions (id, content_json, created_by, published_at, is_draft) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)",
    ).bind(nextId, source.content_json, user.id),
    env.DB.prepare(
      "UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'published_landing_revision'",
    ).bind(nextId),
  ]);
  await audit(env, user.id, "landing.rolled_back", "landing_revision", nextId, {
    sourceRevision: revisionId,
  });
  return json({ ok: true, revisionId: nextId });
}

function validImageMagic(bytes: Uint8Array, type: string): boolean {
  if (type === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png")
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  if (type === "image/webp") {
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

export async function uploadImage(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  requireRole(user, "curator");
  const upload = (await request.formData()).get("image");
  if (!(upload instanceof File)) throw new HttpError(400, "Choose an image.");
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(upload.type) ||
    upload.size > 4_000_000
  ) {
    throw new HttpError(400, "Use a JPEG, PNG, or WebP smaller than 4 MB.");
  }
  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (!validImageMagic(bytes, upload.type))
    throw new HttpError(400, "The image contents do not match its file type.");
  const extension =
    upload.type === "image/jpeg" ? "jpg" : upload.type.split("/")[1];
  const key = `landing/${crypto.randomUUID()}.${extension}`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType: upload.type,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  await audit(env, user.id, "landing.image_uploaded", "media", key, {
    size: upload.size,
    type: upload.type,
  });
  return json({ src: `/media/${key}` }, { status: 201 });
}

export async function media(
  _request: Request,
  env: Env,
  key: string,
): Promise<Response> {
  if (!/^landing\/[a-f0-9-]+\.(jpg|png|webp)$/u.test(key))
    throw new HttpError(404, "Image not found.");
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError(404, "Image not found.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
