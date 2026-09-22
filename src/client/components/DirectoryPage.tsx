import { useEffect, useState } from "react";
import type { PublicProfile } from "../../shared/types";
import { api, jsonBody } from "../api";
import { sealJson } from "../crypto";
import { PageTitle } from "./VaultPage";

export function DirectoryPage({
  masterKey: _masterKey,
}: {
  masterKey: Uint8Array | null;
}) {
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () =>
        api<{ profiles: PublicProfile[] }>(
          `/api/directory?q=${encodeURIComponent(query)}`,
        )
          .then((r) => setProfiles(r.profiles))
          .catch(() => undefined),
      180,
    );
    return () => clearTimeout(timer);
  }, [query]);
  async function requestMail() {
    if (!selected) return;
    setError("");
    try {
      const encryptedNote = note.trim()
        ? await sealJson(selected.publicEncryptionKey, { text: note.trim() })
        : null;
      await api("/api/requests", {
        method: "POST",
        ...jsonBody({ recipientId: selected.id, encryptedNote }),
      });
      setNotice(`Request sent to @${selected.username}.`);
      setSelected(null);
      setNote("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not send request.",
      );
    }
  }
  return (
    <>
      <PageTitle kicker="Consent first" title="Find a mail friend" />
      <label className="search-box">
        <span className="sr-only">Search members</span>
        <input
          type="search"
          placeholder="Search by username or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {notice && <p className="success">{notice}</p>}
      <div className="profile-grid">
        {profiles.map((profile) => (
          <article className="profile-card" key={profile.id}>
            <div className="avatar">
              {profile.displayName?.[0] ?? profile.username[0]}
            </div>
            <h2>{profile.displayName || profile.username}</h2>
            <p className="handle">
              @{profile.username} · {profile.countryCode ?? "country not set"}
            </p>
            <p>{profile.bio || "Keeping the mystery alive."}</p>
            <button
              onClick={() => {
                setSelected(profile);
                setError("");
              }}
            >
              Ask to send mail
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setSelected(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="kicker">Identified request</p>
            <h2 id="request-title">Ask @{selected.username}</h2>
            <p>
              They will see your username and may approve, deny, block, or
              report this request.
            </p>
            <label>
              Optional private note
              <textarea
                maxLength={280}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="button-row">
              <button onClick={requestMail}>Send request</button>
              <button className="secondary" onClick={() => setSelected(null)}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
