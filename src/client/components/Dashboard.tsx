import { useState } from "react";
import type { CurrentUser } from "../../shared/types";
import { CurationPage } from "./CurationPage";
import { DirectoryPage } from "./DirectoryPage";
import { FeedbackPage } from "./FeedbackPage";
import { InboxPage } from "./InboxPage";
import { ModerationPage } from "./ModerationPage";
import { RoulettePage } from "./RoulettePage";
import { SettingsPage } from "./SettingsPage";
import { UpdatesPage } from "./UpdatesPage";
import { VaultPage } from "./VaultPage";

type Tab =
  | "inbox"
  | "directory"
  | "roulette"
  | "vault"
  | "settings"
  | "feedback"
  | "updates"
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

const primaryMobileTabs: Array<[Tab, string]> = [
  ["inbox", "Inbox"],
  ["directory", "People"],
  ["roulette", "Roulette"],
  ["settings", "Settings"],
];

export function Dashboard(props: Props) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const tabs: Array<[Tab, string]> = [
    ["inbox", "Inbox"],
    ["directory", "People"],
    ["roulette", "Roulette"],
    ["vault", "Address vault"],
    ["settings", "Settings"],
    ["feedback", "Feedback"],
  ];
  if (props.user.roles.includes("curator"))
    tabs.push(["curation", "Clara’s page"]);
  if (
    props.user.roles.includes("curator") ||
    props.user.roles.includes("moderator") ||
    props.user.roles.includes("security_admin")
  )
    tabs.push(["updates", "Updates"]);
  if (props.user.roles.includes("moderator"))
    tabs.push(["moderation", "Moderation"]);

  const primaryMobileKeys = new Set(primaryMobileTabs.map(([key]) => key));
  const secondaryTabs = tabs.filter(([key]) => !primaryMobileKeys.has(key));
  const secondaryTabActive = secondaryTabs.some(([key]) => key === tab);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setMobileMenuOpen(false);
  }

  function signOutFromMobileMenu() {
    setMobileMenuOpen(false);
    void props.signOut();
  }

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
              onClick={() => selectTab(key)}
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
        {tab === "feedback" && <FeedbackPage />}
        {tab === "curation" && <CurationPage />}
        {tab === "updates" && <UpdatesPage user={props.user} />}
        {tab === "moderation" && <ModerationPage user={props.user} />}
      </section>

      <nav className="mobile-app-nav" aria-label="Primary account sections">
        {primaryMobileTabs.map(([key, label]) => (
          <button
            className={tab === key ? "active" : ""}
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
        <button
          className={mobileMenuOpen || secondaryTabActive ? "active" : ""}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          More
        </button>
      </nav>

      {mobileMenuOpen && (
        <div
          className="mobile-more-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        >
          <section
            id="mobile-more-menu"
            className="mobile-more-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div className="member-badge">
                <span>
                  {props.user.displayName?.[0] ?? props.user.username[0]}
                </span>
                <div>
                  <strong>{props.user.displayName || props.user.username}</strong>
                  <small>@{props.user.username}</small>
                </div>
              </div>
              <button
                className="mobile-more-close"
                aria-label="Close account menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                ×
              </button>
            </header>
            <h2 id="mobile-more-title" className="sr-only">
              More account sections
            </h2>
            <div className="mobile-more-actions">
              {secondaryTabs.map(([key, label]) => (
                <button
                  className={tab === key ? "active" : ""}
                  key={key}
                  onClick={() => selectTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="mobile-signout" onClick={signOutFromMobileMenu}>
              Sign out
            </button>
          </section>
        </div>
      )}
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
