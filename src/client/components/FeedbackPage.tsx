import { useState } from "react";
import type { FeedbackKind } from "../../shared/types";
import { api, jsonBody } from "../api";
import { PageTitle } from "./VaultPage";

export function FeedbackPage() {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    setError("");
    try {
      const result = await api<{ feedbackId: string; forwarded: boolean }>(
        "/api/feedback",
        {
          method: "POST",
          ...jsonBody({
            kind,
            title,
            summary,
            steps,
            expected,
            actual,
            pageUrl: location.pathname,
          }),
        },
      );
      setNotice(
        `Saved as ${result.feedbackId.slice(0, 18)}. ${
          result.forwarded
            ? "The maintenance workflow received it."
            : "Automation is offline, but moderators can still see it and delivery will retry."
        }`,
      );
      setTitle("");
      setSummary("");
      setSteps("");
      setExpected("");
      setActual("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save feedback.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageTitle kicker="Help shape the beta" title="Feedback" />
      <div className="notice privacy-note">
        <strong>Please leave private information out.</strong>
        <span>
          Do not include postal addresses, recovery codes, invitation links, or
          passkey details. Your username, current page, and deployed build are
          attached automatically for maintenance.
        </span>
      </div>
      <form className="panel settings-form" onSubmit={submit}>
        <label>
          Request type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as FeedbackKind)}
          >
            <option value="bug">Something is broken</option>
            <option value="feature">Feature idea</option>
          </select>
        </label>
        <label>
          Short title
          <input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <label>
          What should we know?
          <textarea
            value={summary}
            maxLength={2000}
            onChange={(event) => setSummary(event.target.value)}
            required
          />
        </label>
        {kind === "bug" && (
          <>
            <label>
              Steps to reproduce <small>optional</small>
              <textarea
                value={steps}
                maxLength={4000}
                onChange={(event) => setSteps(event.target.value)}
              />
            </label>
            <label>
              What did you expect? <small>optional</small>
              <textarea
                value={expected}
                maxLength={2000}
                onChange={(event) => setExpected(event.target.value)}
              />
            </label>
            <label>
              What happened instead? <small>optional</small>
              <textarea
                value={actual}
                maxLength={2000}
                onChange={(event) => setActual(event.target.value)}
              />
            </label>
          </>
        )}
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <button disabled={sending}>
          {sending ? "Sending…" : "Send feedback"}
        </button>
      </form>
    </>
  );
}
