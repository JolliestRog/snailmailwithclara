import { useEffect, useState } from "react";
import { api, jsonBody } from "../api";
import { PageTitle } from "./VaultPage";

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

export function ModerationPage() {
  const [members, setMembers] = useState<PendingMember[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [invite, setInvite] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  async function load() {
    const [memberData, reportData, auditData] = await Promise.all([
      api<{ members: PendingMember[] }>("/api/moderation/members"),
      api<{ reports: Report[] }>("/api/moderation/reports"),
      api<{ events: AuditEvent[] }>("/api/moderation/audit"),
    ]);
    setMembers(memberData.members);
    setReports(reportData.reports);
    setEvents(auditData.events);
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
  async function makeInvite() {
    const result = await api<{ token: string }>("/api/moderation/invitations", {
      method: "POST",
      ...jsonBody({ expiresInDays: 7 }),
    });
    const url = `${location.origin}/join?invite=${encodeURIComponent(result.token)}`;
    setInvite(url);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setNotice(
      "Invitation created and copied. It expires in seven days and works once.",
    );
  }
  async function makeRecovery() {
    const result = await api<{ token: string; username: string }>(
      "/api/moderation/recovery",
      { method: "POST", ...jsonBody({ username: recoveryUsername }) },
    );
    const url = `${location.origin}/recover?username=${encodeURIComponent(result.username)}&token=${encodeURIComponent(result.token)}`;
    setInvite(url);
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
  return (
    <>
      <PageTitle kicker="Care with accountability" title="Moderation desk">
        <button onClick={makeInvite}>Create one-time invite</button>
      </PageTitle>
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {invite && (
        <div className="notice invite-output">
          <strong>One-time link</strong>
          <input readOnly value={invite} onFocus={(e) => e.target.select()} />
        </div>
      )}
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
