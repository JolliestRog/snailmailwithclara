import {
  authStatus,
  loginOptions,
  loginVerify,
  logout,
  recoveryOptions,
  recoveryVerify,
  registrationOptions,
  registrationVerify,
} from "./auth";
import type { Env } from "./context";
import {
  createAnnouncement,
  dispatchAnnouncementEmails,
  listMessages,
  markMessageRead,
  retryAnnouncementEmails,
} from "./communications";
import {
  getCuration,
  listRevisions,
  media,
  publicLanding,
  publishDraft,
  rollbackRevision,
  saveDraft,
  uploadImage,
} from "./curation";
import { assertSameOrigin, errorResponse, json } from "./http";
import {
  createFeedback,
  dispatchPendingFeedback,
  listFeedback,
  updateFeedbackStatus,
} from "./feedback";
import {
  createReport,
  createRequest,
  createRoulette,
  decideRequest,
  listGrants,
  listRequests,
  listRoulette,
  markGrantSent,
  releaseRoulette,
} from "./mail";
import {
  auditLog,
  createInvitation,
  createRecoveryInvitation,
  decideMember,
  listReports,
  pendingMembers,
  resolveReport,
  suspendMember,
  updateRoles,
} from "./moderation";
import {
  blockMember,
  deleteAccount,
  directory,
  getVault,
  me,
  putVault,
  updateProfile,
  updateSettings,
} from "./profile";
import { securityHeaders } from "./security";

type Handler = (
  request: Request,
  env: Env,
  ...captures: string[]
) => Promise<Response>;
type Route = { method: string; pattern: RegExp; handler: Handler };

const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/health$/u,
    handler: async (_request, env) =>
      json({ ok: true, buildSha: env.BUILD_SHA }),
  },
  {
    method: "GET",
    pattern: /^\/api\/public\/landing$/u,
    handler: publicLanding,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/register\/options$/u,
    handler: registrationOptions,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/register\/verify$/u,
    handler: registrationVerify,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/login\/options$/u,
    handler: loginOptions,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/login\/verify$/u,
    handler: loginVerify,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/recovery\/options$/u,
    handler: recoveryOptions,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/recovery\/verify$/u,
    handler: recoveryVerify,
  },
  { method: "POST", pattern: /^\/api\/auth\/logout$/u, handler: logout },
  { method: "GET", pattern: /^\/api\/auth\/status$/u, handler: authStatus },
  { method: "GET", pattern: /^\/api\/me$/u, handler: me },
  { method: "PATCH", pattern: /^\/api\/profile$/u, handler: updateProfile },
  { method: "PATCH", pattern: /^\/api\/settings$/u, handler: updateSettings },
  { method: "GET", pattern: /^\/api\/directory$/u, handler: directory },
  { method: "GET", pattern: /^\/api\/messages$/u, handler: listMessages },
  {
    method: "POST",
    pattern: /^\/api\/messages\/(personal|announcement)\/([^/]+)\/read$/u,
    handler: markMessageRead,
  },
  {
    method: "POST",
    pattern: /^\/api\/announcements$/u,
    handler: createAnnouncement,
  },
  {
    method: "POST",
    pattern: /^\/api\/announcements\/retry$/u,
    handler: retryAnnouncementEmails,
  },
  { method: "POST", pattern: /^\/api\/feedback$/u, handler: createFeedback },
  { method: "GET", pattern: /^\/api\/vault$/u, handler: getVault },
  { method: "PUT", pattern: /^\/api\/vault$/u, handler: putVault },
  {
    method: "POST",
    pattern: /^\/api\/blocks\/([^/]+)$/u,
    handler: blockMember,
  },
  { method: "DELETE", pattern: /^\/api\/account$/u, handler: deleteAccount },
  { method: "GET", pattern: /^\/api\/requests$/u, handler: listRequests },
  { method: "POST", pattern: /^\/api\/requests$/u, handler: createRequest },
  {
    method: "POST",
    pattern: /^\/api\/requests\/([^/]+)\/decision$/u,
    handler: decideRequest,
  },
  { method: "GET", pattern: /^\/api\/roulette$/u, handler: listRoulette },
  { method: "POST", pattern: /^\/api\/roulette$/u, handler: createRoulette },
  {
    method: "POST",
    pattern: /^\/api\/roulette\/([^/]+)\/release$/u,
    handler: releaseRoulette,
  },
  { method: "GET", pattern: /^\/api\/grants$/u, handler: listGrants },
  {
    method: "POST",
    pattern: /^\/api\/grants\/([^/]+)\/sent$/u,
    handler: markGrantSent,
  },
  { method: "POST", pattern: /^\/api\/reports$/u, handler: createReport },
  { method: "GET", pattern: /^\/api\/curation$/u, handler: getCuration },
  { method: "PUT", pattern: /^\/api\/curation\/draft$/u, handler: saveDraft },
  {
    method: "POST",
    pattern: /^\/api\/curation\/publish$/u,
    handler: publishDraft,
  },
  {
    method: "GET",
    pattern: /^\/api\/curation\/revisions$/u,
    handler: listRevisions,
  },
  {
    method: "POST",
    pattern: /^\/api\/curation\/revisions\/([^/]+)\/rollback$/u,
    handler: rollbackRevision,
  },
  {
    method: "POST",
    pattern: /^\/api\/curation\/images$/u,
    handler: uploadImage,
  },
  {
    method: "GET",
    pattern: /^\/api\/moderation\/members$/u,
    handler: pendingMembers,
  },
  {
    method: "POST",
    pattern: /^\/api\/moderation\/members\/([^/]+)\/decision$/u,
    handler: decideMember,
  },
  {
    method: "POST",
    pattern: /^\/api\/moderation\/members\/([^/]+)\/suspension$/u,
    handler: suspendMember,
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/members\/([^/]+)\/roles$/u,
    handler: updateRoles,
  },
  {
    method: "POST",
    pattern: /^\/api\/moderation\/invitations$/u,
    handler: createInvitation,
  },
  {
    method: "POST",
    pattern: /^\/api\/moderation\/recovery$/u,
    handler: createRecoveryInvitation,
  },
  {
    method: "GET",
    pattern: /^\/api\/moderation\/reports$/u,
    handler: listReports,
  },
  {
    method: "POST",
    pattern: /^\/api\/moderation\/reports\/([^/]+)$/u,
    handler: resolveReport,
  },
  { method: "GET", pattern: /^\/api\/moderation\/audit$/u, handler: auditLog },
  {
    method: "GET",
    pattern: /^\/api\/moderation\/feedback$/u,
    handler: listFeedback,
  },
  {
    method: "POST",
    pattern: /^\/api\/moderation\/feedback\/([^/]+)$/u,
    handler: updateFeedbackStatus,
  },
];

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/media/"))
    return media(request, env, decodeURIComponent(url.pathname.slice(7)));
  if (url.pathname.startsWith("/api/")) {
    assertSameOrigin(request, env.ORIGIN);
    for (const route of routes) {
      const match = url.pathname.match(route.pattern);
      if (route.method === request.method && match)
        return route.handler(request, env, ...match.slice(1));
    }
    return json({ error: "Not found." }, { status: 404 });
  }
  return env.ASSETS.fetch(request);
}

async function cleanup(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP",
    ),
    env.DB.prepare(
      "DELETE FROM webauthn_challenges WHERE expires_at <= CURRENT_TIMESTAMP",
    ),
    env.DB.prepare(
      "DELETE FROM recovery_invitations WHERE expires_at < datetime('now', '-1 day')",
    ),
    env.DB.prepare(
      "UPDATE mail_requests SET status = 'expired' WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP",
    ),
    env.DB.prepare(
      "UPDATE roulette_matches SET status = 'expired' WHERE status = 'pending_release' AND release_expires_at <= CURRENT_TIMESTAMP",
    ),
    env.DB.prepare(
      "UPDATE address_grants SET status = 'expired', encrypted_address_json = '{}' WHERE status = 'active' AND expires_at <= CURRENT_TIMESTAMP",
    ),
    env.DB.prepare(
      "DELETE FROM mail_requests WHERE status IN ('denied', 'expired', 'cancelled') AND created_at < datetime('now', '-30 days')",
    ),
    env.DB.prepare(
      "DELETE FROM roulette_matches WHERE status IN ('completed', 'expired', 'cancelled') AND created_at < datetime('now', '-90 days')",
    ),
  ]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return securityHeaders(await handle(request, env));
    } catch (error) {
      return securityHeaders(errorResponse(error));
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(
      Promise.all([
        cleanup(env),
        dispatchPendingFeedback(env),
        dispatchAnnouncementEmails(env),
      ]).then(() => undefined),
    );
  },
};
