import { useState } from "react";
import type { AnnouncementKind, CurrentUser } from "../../shared/types";
import { api, jsonBody } from "../api";
import { PageTitle } from "./VaultPage";

export function UpdatesPage({ user }: { user: CurrentUser }) {
  const canNewsletter =
    user.roles.includes("curator") || user.roles.includes("security_admin");
  const canModerate =
    user.roles.includes("moderator") || user.roles.includes("security_admin");
  const [kind, setKind] = useState<AnnouncementKind>(
    canNewsletter ? "newsletter" : "update",
  );
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    const description =
      kind === "newsletter"
        ? "members who opted into Clara's newsletters"
        : "all active members in-app, plus members who enabled email alerts";
    if (!confirm(`Publish this ${kind} to ${description}?`)) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{
        email: { attempted: number; sent: number; configured: boolean };
      }>("/api/announcements", {
        method: "POST",
        ...jsonBody({ kind, subject, message }),
      });
      const emailSummary = result.email.configured
        ? `${result.email.sent} email${result.email.sent === 1 ? "" : "s"} sent.`
        : "Email is not configured; the in-app message was published.";
      setNotice(`Published. ${emailSummary}`);
      setSubject("");
      setMessage("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not publish update.",
      );
    } finally {
      setSending(false);
    }
  }

  async function retryEmail() {
    setError("");
    const result = await api<{
      attempted: number;
      sent: number;
      configured: boolean;
    }>("/api/announcements/retry", { method: "POST" });
    setNotice(
      result.configured
        ? `Retried ${result.attempted}; ${result.sent} sent.`
        : "Resend is not configured.",
    );
  }

  return (
    <>
      <PageTitle kicker="Keep the group informed" title="Updates" />
      <div className="notice privacy-note">
        <strong>Consent stays separate.</strong>
        <span>
          Newsletters reach only members who opted in. Updates and warnings are
          visible in-app to active members; email goes only to members who
          enabled alerts. Recipient addresses are never shown to other
          recipients.
        </span>
      </div>
      <form className="panel settings-form" onSubmit={publish}>
        <label>
          Message type
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as AnnouncementKind)
            }
          >
            {canNewsletter && (
              <option value="newsletter">Clara newsletter</option>
            )}
            {canModerate && <option value="update">Community update</option>}
            {canModerate && <option value="warning">Safety warning</option>}
          </select>
        </label>
        <label>
          Subject
          <input
            value={subject}
            maxLength={120}
            onChange={(event) => setSubject(event.target.value)}
            required
          />
        </label>
        <label>
          Message
          <textarea
            value={message}
            maxLength={8000}
            rows={12}
            onChange={(event) => setMessage(event.target.value)}
            required
          />
        </label>
        {subject && message && (
          <article className={`account-message message-${kind}`}>
            <span className="status">Preview · {kind}</span>
            <h3>{subject}</h3>
            <p className="pre-wrap">{message}</p>
          </article>
        )}
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <div className="button-row">
          <button disabled={sending}>
            {sending ? "Publishing…" : "Review and publish"}
          </button>
          {canModerate && (
            <button type="button" className="secondary" onClick={retryEmail}>
              Retry failed email
            </button>
          )}
        </div>
      </form>
    </>
  );
}
