import { useEffect, useState } from "react";
import type { CurrentUser, FeedbackView, Role } from "../../shared/types";
import { api, jsonBody } from "../api";
import { PageTitle } from "./VaultPage";

type InvitePreset = "member" | "moderator" | "clara";

const inviteRoles: Record<InvitePreset, Role[]> = {
  member: ["member"],
  moderator: ["member", "moderator"],
  clara: ["member", "moderator", "curator"],
};

interface PendingMember {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
}
interface Report {
  id: string;
  category: string;
  details: string;
  status: string;
  created_at: string;
  reporter_username: string;
  subject_username: string;
  subject_id: string;
}
interface AuditEvent {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  actor: string | null;
  created_at: string;
}

export function ModerationPage({ user }: { user: CurrentUser }) {
  const [members, setMembers] = useState<PendingMember[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [feedback, setFeedback] = useState<FeedbackView[]>([]);
  const [inviteOutput, setInviteOutput] = useState("");
  const [inviteCount, setInviteCount] = useState(1);
  const [inviteDays, setInviteDays] = useState(7);
  const [invitePreset, setInvitePreset] = useState<InvitePreset>("member");
  const [creatingInvites, setCreatingInvites] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  async function load() {
    const [memberData, reportData, auditData, feedbackData] = await Promise.all(
      [
        api<{ members: PendingMember[] }>("/api/moderation/members"),
        api<{ reports: Report[] }>("/api/moderation/reports"),
        api<{ events: AuditEvent[] }>("/api/moderation/audit"),
        api<{ feedback: FeedbackView[] }>("/api/moderation/feedback"),
      ],
    );
    setMembers(memberData.members);
    setReports(reportData.reports);
    setEvents(auditData.events);
    setFeedback(feedbackData.feedback);
  }
  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Could not load moderation."),
    );
  }, []);
  async function decide(id: string, decision: "approve" | "deny") {
    await api(`/api/moderation/members/${id}/decision`, {
      method: "POST",
      ...jsonBody({ decision }),
    });
    setNotice(`Application ${decision === "approve" ? "approved" : "denied"}.`);
    await load();
  }
  async function makeInvites() {
    setCreatingInvites(true);
    setError("");
    try {
      const result = await api<{
        invitations: Array<{ token: string; expiresAt: string }>;
      }>("/api/moderation/invitations", {
        method: "POST",
        ...jsonBody({
          count: inviteCount,
          expiresInDays: inviteDays,
          roles: inviteRoles[invitePreset],
        }),
      });
      const urls = result.invitations.map(
        ({ token }) =>
          `${location.origin}/join?invite=${encodeURIComponent(token)}`,
      );
      const output = urls.join("\n");
      setInviteOutput(output);
      await navigator.clipboard.writeText(output).catch(() => undefined);
      setNotice(
        `${urls.length} one-time invitation${urls.length === 1 ? "" : "s"} created and copied. They expire in ${inviteDays} day${inviteDays === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create invitations.",
      );
    } finally {
      setCreatingInvites(false);
    }
  }
  async function makeRecovery() {
    const result = await api<{ token: string; username: string }>(
      "/api/moderation/recovery",
      { method: "POST", ...jsonBody({ username: recoveryUsername }) },
    );
    const url = `${location.origin}/recover?username=${encodeURIComponent(result.username)}&token=${encodeURIComponent(result.token)}`;
    setInviteOutput(url);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setNotice(
      "Recovery link created and copied. It expires in 30 minutes and does not reveal or reset the address vault.",
    );
  }
  async function updateReport(
    report: Report,
    status: "reviewing" | "resolved" | "dismissed",
    suspendSubject = false,
  ) {
    await api(`/api/moderation/reports/${report.id}`, {
      method: "POST",
      ...jsonBody({ status, suspendSubject }),
    });
    setNotice("Report updated.");
    await load();
  }
  async function updateFeedback(
    item: FeedbackView,
    status: FeedbackView["status"],
  ) {
    await api(`/api/moderation/feedback/${item.id}`, {
      method: "POST",
      ...jsonBody({ status }),
    });
    setNotice(`Feedback marked ${status}.`);
    await load();
  }
  return (
    <>
      <PageTitle kicker="Care with accountability" title="Moderation desk" />
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {inviteOutput && (
        <div className="notice invite-output">
          <strong>Private one-time links</strong>
          <textarea
            readOnly
            rows={Math.min(10, inviteOutput.split("\n").length + 1)}
            value={inviteOutput}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      <section className="panel recovery-tools">
        <h2>Create invitation codes</h2>
        <p>
          Codes are not attached to usernames. Each works once; whoever receives
          it chooses their username during registration.
        </p>
        <div className="form-grid">
          <label>
            Access
            <select
              value={invitePreset}
              onChange={(event) =>
                setInvitePreset(event.target.value as InvitePreset)
              }
            >
              <option value="member">Beta member</option>
              {user.roles.includes("security_admin") && (
                <>
                  <option value="moderator">Member + moderator</option>
                  <option value="clara">
                    Clara: member + moderator + curator
                  </option>
                </>
              )}
            </select>
          </label>
          <label>
            Number of codes
            <input
              type="number"
              min="1"
              max="50"
              value={inviteCount}
              onChange={(event) => setInviteCount(Number(event.target.value))}
            />
          </label>
          <label>
            Expires after days
            <input
              type="number"
              min="1"
              max="30"
              value={inviteDays}
              onChange={(event) => setInviteDays(Number(event.target.value))}
            />
          </label>
        </div>
        <button onClick={makeInvites} disabled={creatingInvites}>
          {creatingInvites ? "Creating…" : "Create and copy codes"}
        </button>
        <p className="fine-print">
          Security administrator access is never granted by an invitation code.
        </p>
      </section>
      <section className="panel recovery-tools">
        <h2>Lost-passkey recovery</h2>
        <p>
          Verify the member outside this app first. This creates a 30-minute
          link for adding a new passkey; it cannot decrypt their postal data.
        </p>
        <div className="button-row">
          <input
            aria-label="Member username"
            placeholder="username"
            value={recoveryUsername}
            onChange={(e) => setRecoveryUsername(e.target.value.toLowerCase())}
          />
          <button onClick={makeRecovery} disabled={!recoveryUsername}>
            Issue recovery link
          </button>
        </div>
      </section>
      <div className="moderation-grid">
        <section className="panel">
          <h2>
            Applications <span className="count-badge">{members.length}</span>
          </h2>
          <div className="stack-list">
            {members.length === 0 && (
              <p className="empty">No applications waiting.</p>
            )}
            {members.map((member) => (
              <article className="mini-card" key={member.id}>
                <strong>{member.display_name || member.username}</strong>
                <span>@{member.username}</span>
                <small>
                  Attested 18+ ·{" "}
                  {new Date(member.created_at).toLocaleDateString()}
                </small>
                <div className="button-row">
                  <button onClick={() => decide(member.id, "approve")}>
                    Approve
                  </button>
                  <button
                    className="secondary"
                    onClick={() => decide(member.id, "deny")}
                  >
                    Deny
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>
            Open reports <span className="count-badge">{reports.length}</span>
          </h2>
          <p className="fine-print">
            Viewing this queue reveals accountable identities and is recorded in
            the audit log.
          </p>
          <div className="stack-list">
            {reports.length === 0 && <p className="empty">No open reports.</p>}
            {reports.map((report) => (
              <article className="report-card" key={report.id}>
                <strong>{report.category.replaceAll("-", " ")}</strong>
                <p>
                  Reporter: @{report.reporter_username}
                  <br />
                  Subject: @{report.subject_username}
                </p>
                <blockquote>
                  {report.details || "No details supplied."}
                </blockquote>
                <div className="button-row">
                  <button onClick={() => updateReport(report, "resolved")}>
                    Resolve
                  </button>
                  <button
                    className="secondary"
                    onClick={() => updateReport(report, "dismissed")}
                  >
                    Dismiss
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      confirm(`Suspend @${report.subject_username}?`) &&
                      updateReport(report, "resolved", true)
                    }
                  >
                    Suspend
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="panel audit-panel">
        <h2>
          Beta feedback <span className="count-badge">{feedback.length}</span>
        </h2>
        <div className="stack-list">
          {feedback.length === 0 && <p className="empty">No feedback yet.</p>}
          {feedback.map((item) => (
            <article className="report-card" key={item.id}>
              <div className="message-heading">
                <strong>{item.title}</strong>
                <span className={`status status-${item.status}`}>
                  {item.status}
                </span>
              </div>
              <small>
                {item.kind} from @{item.username} · build{" "}
                {item.buildSha.slice(0, 10)}
                {item.n8nStatus !== "delivered" &&
                  ` · automation ${item.n8nStatus}`}
              </small>
              <p className="pre-wrap">{item.summary}</p>
              {item.steps && (
                <details>
                  <summary>Steps and expected result</summary>
                  <p className="pre-wrap">{item.steps}</p>
                  {item.expected && <p>Expected: {item.expected}</p>}
                  {item.actual && <p>Actual: {item.actual}</p>}
                </details>
              )}
              <div className="button-row">
                <button onClick={() => updateFeedback(item, "triaged")}>
                  Triaged
                </button>
                <button
                  className="secondary"
                  onClick={() => updateFeedback(item, "planned")}
                >
                  Planned
                </button>
                <button
                  className="secondary"
                  onClick={() => updateFeedback(item, "closed")}
                >
                  Close
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel audit-panel">
        <h2>Recent audit trail</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.created_at).toLocaleString()}</td>
                <td>{event.actor ? `@${event.actor}` : "system"}</td>
                <td>{event.action}</td>
                <td>
                  {event.target_type}
                  {event.target_id ? ` · ${event.target_id.slice(0, 12)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
