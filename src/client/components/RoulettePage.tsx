import { useEffect, useState } from "react";
import type { CurrentUser, RouletteMatchView } from "../../shared/types";
import { api, jsonBody } from "../api";
import { PageTitle } from "./VaultPage";

export function RoulettePage({ user }: { user: CurrentUser }) {
  const [anonymous, setAnonymous] = useState(true);
  const [countries, setCountries] = useState("");
  const [matches, setMatches] = useState<RouletteMatchView[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () =>
    api<{ matches: RouletteMatchView[] }>("/api/roulette").then((r) =>
      setMatches(r.matches),
    );
  useEffect(() => {
    void load();
  }, []);
  async function draw() {
    setError("");
    setNotice("");
    try {
      await api("/api/roulette", {
        method: "POST",
        ...jsonBody({
          anonymous,
          destinationCountries: countries
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
        }),
      });
      setNotice(
        "Match found. The recipient will release the encrypted label next time they unlock their vault.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not draw a match.",
      );
    }
  }
  return (
    <>
      <PageTitle kicker="A little postal chaos" title="Mail roulette" />
      <div className="roulette-layout">
        <section className="panel roulette-machine">
          <div className="roulette-wheel" aria-hidden="true">
            ✉
          </div>
          <h2>Draw one recipient</h2>
          <p>
            Matches exclude blocks, recent pairings, and anyone over their
            monthly limit.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />{" "}
            Keep my account identity hidden from the recipient
          </label>
          <label>
            Countries you can mail to <small>optional, comma separated</small>
            <input
              placeholder="US, CA, GB"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
            />
          </label>
          {anonymous && (
            <p className="fine-print">
              Anonymous means hidden from the recipient. Moderators can identify
              an account after an abuse report, and infrastructure retains
              routing metadata.
            </p>
          )}
          {!user.hasAddress && (
            <p className="warning">
              Add your own address before opting in to receive roulette mail.
            </p>
          )}
          {notice && <p className="success">{notice}</p>}
          {error && <p className="error">{error}</p>}
          <button onClick={draw}>Spin the mail wheel</button>
        </section>
        <section>
          <h2>Recent draws</h2>
          <div className="stack-list">
            {matches.length === 0 && (
              <p className="empty">No roulette history yet.</p>
            )}
            {matches.map((match) => (
              <article className="mini-card" key={match.id}>
                <strong>
                  {match.direction === "outgoing"
                    ? `To ${match.member?.displayName || match.member?.username || "a random member"}`
                    : match.anonymous
                      ? "Anonymous incoming mail"
                      : `From ${match.member?.displayName || match.member?.username}`}
                </strong>
                <span className={`status status-${match.status}`}>
                  {match.status.replaceAll("_", " ")}
                </span>
                <small>{new Date(match.createdAt).toLocaleDateString()}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
