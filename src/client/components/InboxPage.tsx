import { useEffect, useRef, useState } from "react";
import type {
  CurrentUser,
  GrantView,
  MailRequestView,
  PostalAddress,
  RouletteMatchView,
  VaultRecord,
} from "../../shared/types";
import { api, jsonBody } from "../api";
import { decryptAddress, formatAddress, openSealed, sealJson } from "../crypto";
import { VaultLocked } from "./Dashboard";
import { PageTitle } from "./VaultPage";

type MatchWithReleaseKey = RouletteMatchView & { releasePublicKey?: string };

export function InboxPage({
  user,
  masterKey,
  unlock,
  unlockError,
}: {
  user: CurrentUser;
  masterKey: Uint8Array | null;
  unlock: (code: string) => Promise<void>;
  unlockError: string;
}) {
  const [requests, setRequests] = useState<MailRequestView[]>([]);
  const [matches, setMatches] = useState<MatchWithReleaseKey[]>([]);
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [openAddress, setOpenAddress] = useState<{
    id: string;
    address: PostalAddress;
  } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const releasing = useRef(false);
  async function load() {
    const [requestData, matchData, grantData, vaultData] = await Promise.all([
      api<{ requests: MailRequestView[] }>("/api/requests"),
      api<{ matches: MatchWithReleaseKey[] }>("/api/roulette"),
      api<{ grants: GrantView[] }>("/api/grants"),
      api<{ vault: VaultRecord }>("/api/vault"),
    ]);
    setRequests(requestData.requests);
    setMatches(matchData.matches);
    setGrants(grantData.grants);
    setVault(vaultData.vault);
  }
  useEffect(() => {
    void load().catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : "Could not load mail.",
      ),
    );
  }, []);
  useEffect(() => {
    if (!masterKey || !vault?.encryptedAddress || releasing.current) return;
    const pending = matches.filter(
      (m) =>
        m.direction === "incoming" &&
        m.status === "pending_release" &&
        m.releasePublicKey,
    );
    if (!pending.length) return;
    releasing.current = true;
    void (async () => {
      try {
        const address = await decryptAddress(
          masterKey,
          vault.encryptedAddress!,
        );
        for (const match of pending) {
          const encryptedAddress = await sealJson(
            match.releasePublicKey!,
            address,
          );
          await api(`/api/roulette/${match.id}/release`, {
            method: "POST",
            ...jsonBody({ encryptedAddress }),
          });
        }
        setNotice(
          `${pending.length} opted-in roulette match${pending.length === 1 ? "" : "es"} released securely.`,
        );
        await load();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not release a match.",
        );
      } finally {
        releasing.current = false;
      }
    })();
  }, [masterKey, vault, matches]);
  async function decide(item: MailRequestView, decision: "approve" | "deny") {
    setError("");
    try {
      let encryptedAddress;
      if (decision === "approve") {
        if (!masterKey || !vault?.encryptedAddress)
          throw new Error("Unlock the vault and add an address first.");
        const address = await decryptAddress(masterKey, vault.encryptedAddress);
        encryptedAddress = await sealJson(
          item.member.publicEncryptionKey,
          address,
        );
      }
      await api(`/api/requests/${item.id}/decision`, {
        method: "POST",
        ...jsonBody({ decision, encryptedAddress }),
      });
      setNotice(
        decision === "approve"
          ? "Address access approved for 14 days."
          : "Request denied.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update request.",
      );
    }
  }
  async function readNote(item: MailRequestView) {
    if (!item.encryptedNote || !masterKey || !vault) return;
    try {
      const value = (await openSealed(
        masterKey,
        vault.encryptedPrivateKey,
        item.encryptedNote,
      )) as { text?: string };
      setNotes({ ...notes, [item.id]: value.text ?? "" });
    } catch {
      setError("Could not decrypt that private note.");
    }
  }
  async function showGrant(grant: GrantView) {
    if (!masterKey || !vault) return;
    try {
      const value = (await openSealed(
        masterKey,
        vault.encryptedPrivateKey,
        grant.encryptedAddress,
      )) as PostalAddress;
      setOpenAddress({ id: grant.id, address: value });
    } catch {
      setError("Could not decrypt this address grant.");
    }
  }
  async function markSent(id: string) {
    await api(`/api/grants/${id}/sent`, { method: "POST" });
    setOpenAddress(null);
    setNotice("Marked sent; the encrypted grant was removed.");
    await load();
  }
  async function report(match: MatchWithReleaseKey) {
    const details = prompt(
      "Briefly describe what happened. Avoid including postal addresses.",
    );
    if (details === null) return;
    await api("/api/reports", {
      method: "POST",
      ...jsonBody({ matchId: match.id, category: "unwanted-mail", details }),
    });
    setNotice("Report sent to the moderator team.");
  }
  async function block(memberId: string) {
    if (
      !confirm(
        "Block this member and revoke active in-app address access between you?",
      )
    )
      return;
    await api(`/api/blocks/${memberId}`, { method: "POST" });
    setNotice("Member blocked.");
    await load();
  }
  async function reportMember(memberId: string) {
    const details = prompt(
      "Briefly describe the concern. Avoid including postal addresses.",
    );
    if (details === null) return;
    await api("/api/reports", {
      method: "POST",
      ...jsonBody({
        subjectUserId: memberId,
        category: "targeted-request",
        details,
      }),
    });
    setNotice("Report sent to the moderator team.");
  }
  const incoming = requests.filter(
    (item) => item.direction === "incoming" && item.status === "pending",
  );
  return (
    <>
      <PageTitle
        kicker={`Hello, ${user.displayName || user.username}`}
        title="Your mailbox"
      >
        <span className="count-badge">{incoming.length} pending</span>
      </PageTitle>
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {!masterKey && <VaultLocked unlock={unlock} error={unlockError} />}
      <div className="inbox-grid">
        <section>
          <h2>Requests for you</h2>
          <div className="stack-list">
            {incoming.length === 0 && (
              <p className="empty">Nothing waiting right now.</p>
            )}
            {incoming.map((item) => (
              <article className="mail-card" key={item.id}>
                <div>
                  <span className="mail-icon" aria-hidden="true">
                    ✉
                  </span>
                  <h3>{item.member.displayName || item.member.username}</h3>
                  <p>@{item.member.username} would like to send you mail.</p>
                  {item.encryptedNote && !notes[item.id] && (
                    <button
                      className="text-button"
                      disabled={!masterKey}
                      onClick={() => readNote(item)}
                    >
                      Decrypt their private note
                    </button>
                  )}
                  {notes[item.id] && <blockquote>{notes[item.id]}</blockquote>}
                </div>
                <div className="button-row">
                  <button
                    disabled={!masterKey || !user.hasAddress}
                    onClick={() => decide(item, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="secondary"
                    onClick={() => decide(item, "deny")}
                  >
                    Deny
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => block(item.member.id)}
                  >
                    Block
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => reportMember(item.member.id)}
                  >
                    Report
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section>
          <h2>Addresses shared with you</h2>
          <div className="stack-list">
            {grants.filter((g) => g.status === "active").length === 0 && (
              <p className="empty">Approved mailing labels appear here.</p>
            )}
            {grants
              .filter((g) => g.status === "active")
              .map((grant) => (
                <article className="mini-card" key={grant.id}>
                  <strong>
                    {grant.recipient.displayName || grant.recipient.username}
                  </strong>
                  <span>
                    Expires {new Date(grant.expiresAt).toLocaleDateString()}
                  </span>
                  <button
                    disabled={!masterKey}
                    onClick={() => showGrant(grant)}
                  >
                    Decrypt mailing label
                  </button>
                </article>
              ))}
          </div>
        </section>
        <section>
          <h2>Roulette arriving</h2>
          <div className="stack-list">
            {matches
              .filter((m) => m.direction === "incoming")
              .map((match) => (
                <article className="mini-card" key={match.id}>
                  <strong>
                    {match.anonymous
                      ? "Anonymous member"
                      : match.member?.username}
                  </strong>
                  <span className={`status status-${match.status}`}>
                    {match.status.replaceAll("_", " ")}
                  </span>
                  <button
                    className="text-button danger-text"
                    onClick={() => report(match)}
                  >
                    Report match
                  </button>
                </article>
              ))}
          </div>
        </section>
      </div>
      {openAddress && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setOpenAddress(null)}
        >
          <section
            className="modal address-label"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="kicker">Private mailing label</p>
            <pre>{formatAddress(openAddress.address)}</pre>
            <p className="warning">
              This access expires. A screenshot or handwritten copy cannot be
              revoked.
            </p>
            <div className="button-row">
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    formatAddress(openAddress.address),
                  )
                }
              >
                Copy label
              </button>
              <button onClick={() => print()}>Print</button>
              <button
                className="secondary"
                onClick={() => markSent(openAddress.id)}
              >
                Mark sent & remove
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
