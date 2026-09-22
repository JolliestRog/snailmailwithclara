import { useState } from "react";
import type { CurrentUser } from "../../shared/types";
import { CurationPage } from "./CurationPage";
import { DirectoryPage } from "./DirectoryPage";
import { InboxPage } from "./InboxPage";
import { ModerationPage } from "./ModerationPage";
import { RoulettePage } from "./RoulettePage";
import { SettingsPage } from "./SettingsPage";
import { VaultPage } from "./VaultPage";

type Tab =
  | "inbox"
  | "directory"
  | "roulette"
  | "vault"
  | "settings"
  | "curation"
  | "moderation";

interface Props {
  user: CurrentUser;
  refreshUser: () => Promise<void>;
  masterKey: Uint8Array | null;
  unlock: (code: string) => Promise<void>;
  unlockError: string;
  signOut: () => Promise<void>;
}

export function Dashboard(props: Props) {
  const [tab, setTab] = useState<Tab>("inbox");
  const tabs: Array<[Tab, string]> = [
    ["inbox", "Inbox"],
    ["directory", "People"],
    ["roulette", "Roulette"],
    ["vault", "Address vault"],
    ["settings", "Settings"],
  ];
  if (props.user.roles.includes("curator"))
    tabs.push(["curation", "Clara’s page"]);
  if (props.user.roles.includes("moderator"))
    tabs.push(["moderation", "Moderation"]);
  return (
    <main id="main" className="app-shell">
      <aside className="app-sidebar">
        <div className="member-badge">
          <span>{props.user.displayName?.[0] ?? props.user.username[0]}</span>
          <div>
            <strong>{props.user.displayName || props.user.username}</strong>
            <small>@{props.user.username}</small>
          </div>
        </div>
        <nav aria-label="Account sections">
          {tabs.map(([key, label]) => (
            <button
              className={tab === key ? "active" : ""}
              key={key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="text-button" onClick={props.signOut}>
          Sign out
        </button>
      </aside>
      <section className="app-content">
        {tab === "inbox" && (
          <InboxPage
            user={props.user}
            masterKey={props.masterKey}
            unlock={props.unlock}
            unlockError={props.unlockError}
          />
        )}
        {tab === "directory" && <DirectoryPage masterKey={props.masterKey} />}
        {tab === "roulette" && <RoulettePage user={props.user} />}
        {tab === "vault" && (
          <VaultPage
            user={props.user}
            masterKey={props.masterKey}
            unlock={props.unlock}
            unlockError={props.unlockError}
            refreshUser={props.refreshUser}
          />
        )}
        {tab === "settings" && (
          <SettingsPage user={props.user} refreshUser={props.refreshUser} />
        )}
        {tab === "curation" && <CurationPage />}
        {tab === "moderation" && <ModerationPage />}
      </section>
    </main>
  );
}

export function VaultLocked({
  unlock,
  error,
}: {
  unlock: (code: string) => Promise<void>;
  error: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await unlock(code);
      setCode("");
    } catch {
      /* parent displays error */
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="locked-card">
      <span className="lock-icon" aria-hidden="true">
        ⌾
      </span>
      <h2>Unlock this device</h2>
      <p>
        Enter the recovery code once to make the encrypted address vault
        available on this browser.
      </p>
      <form onSubmit={submit}>
        <label>
          Recovery code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Unlocking…" : "Unlock vault"}</button>
      </form>
    </div>
  );
}
