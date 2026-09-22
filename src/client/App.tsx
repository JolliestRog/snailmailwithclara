import { useEffect, useState } from "react";
import type { CurrentUser, LandingContent, VaultRecord } from "../shared/types";
import { api } from "./api";
import { loadMasterFromDevice, recoverMaster } from "./crypto";
import { AuthPanel } from "./components/AuthPanel";
import { Dashboard } from "./components/Dashboard";
import { Landing, TrustStrip } from "./components/Landing";
import { PolicyPage } from "./components/Policies";
import { RecoveryPanel } from "./components/RecoveryPanel";

const fallbackLanding: LandingContent = {
  theme: "signal-red",
  blocks: [
    {
      id: "loading",
      type: "hero",
      eyebrow: "Loading the post",
      title: "Snail Mail with Clara",
      body: "Fold. Stamp. Send.",
      ctaLabel: "Sign in",
      ctaHref: "/login",
    },
  ],
};

export function App() {
  const [path, setPath] = useState(location.pathname);
  const [landing, setLanding] = useState(fallbackLanding);
  const [buildSha, setBuildSha] = useState("development");
  const [repositoryUrl, setRepositoryUrl] = useState("https://github.com/");
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [unlockError, setUnlockError] = useState("");

  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        'a[href^="/"]',
      );
      if (!anchor || anchor.target || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      history.pushState({}, "", anchor.href);
      setPath(location.pathname);
      scrollTo({ top: 0, behavior: "smooth" });
    };
    const pop = () => setPath(location.pathname);
    document.addEventListener("click", navigate);
    addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("click", navigate);
      removeEventListener("popstate", pop);
    };
  }, []);

  useEffect(() => {
    api<{ content: LandingContent; buildSha: string; repositoryUrl: string }>(
      "/api/public/landing",
    )
      .then((result) => {
        setLanding(result.content);
        setBuildSha(result.buildSha);
        setRepositoryUrl(result.repositoryUrl);
      })
      .catch(() => undefined);
    void refreshUser();
  }, []);

  async function refreshUser() {
    const result = await api<{ user: CurrentUser | null }>("/api/me");
    setUser(result.user);
    if (result.user) setMasterKey(await loadMasterFromDevice(result.user.id));
  }

  async function unlock(code: string): Promise<void> {
    if (!user) return;
    setUnlockError("");
    try {
      const { vault } = await api<{ vault: VaultRecord }>("/api/vault");
      setMasterKey(await recoverMaster(user.id, vault, code));
    } catch (error) {
      setUnlockError(
        error instanceof Error ? error.message : "Could not unlock the vault.",
      );
      throw error;
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMasterKey(null);
    history.pushState({}, "", "/");
    setPath("/");
  }

  const policy =
    path === "/privacy"
      ? "privacy"
      : path === "/safety"
        ? "safety"
        : path === "/how-it-works"
          ? "how"
          : null;
  const appPage = path.startsWith("/app");

  return (
    <div className={`site-shell theme-${landing.theme}`}>
      <header className="site-header">
        <a className="wordmark" href="/">
          <span aria-hidden="true">✉</span> Snail Mail <em>with Clara</em>
        </a>
        <nav aria-label="Main navigation">
          <a href="/how-it-works">How it works</a>
          <a href="/safety">Safety</a>
          <a href="/privacy">Privacy</a>
          {user ? (
            <a className="nav-cta" href="/app">
              My mail
            </a>
          ) : (
            <a className="nav-cta" href="/login">
              Sign in
            </a>
          )}
        </nav>
      </header>
      {path === "/" && (
        <>
          <Landing content={landing} />
          <TrustStrip repositoryUrl={repositoryUrl} />
        </>
      )}
      {policy && <PolicyPage page={policy} />}
      {(path === "/login" || path === "/join") && (
        <main id="main" className="auth-page">
          <AuthPanel
            mode={path === "/join" ? "join" : "login"}
            onAuthenticated={refreshUser}
          />
        </main>
      )}
      {path === "/recover" && (
        <main id="main" className="auth-page">
          <RecoveryPanel onAuthenticated={refreshUser} />
        </main>
      )}
      {appPage && user === undefined && (
        <main id="main" className="loading-page">
          <p>Opening the mailbox…</p>
        </main>
      )}
      {appPage && user === null && (
        <main id="main" className="auth-page">
          <AuthPanel mode="login" onAuthenticated={refreshUser} />
        </main>
      )}
      {appPage && user?.status === "pending" && (
        <main id="main" className="status-card">
          <p className="kicker">Application received</p>
          <h1>Waiting for a moderator</h1>
          <p>
            Your passkey and encrypted vault are ready. Clara or another
            moderator still needs to approve the membership.
          </p>
          <button onClick={signOut}>Sign out</button>
        </main>
      )}
      {appPage && user?.status === "active" && (
        <Dashboard
          user={user}
          refreshUser={refreshUser}
          masterKey={masterKey}
          unlock={unlock}
          unlockError={unlockError}
          signOut={signOut}
        />
      )}
      <footer className="site-footer">
        <div>
          <strong>Snail Mail with Clara</strong>
          <span>
            Unofficial. Made with care for a private Riot Fest community.
          </span>
        </div>
        <div>
          <a href="/privacy">Privacy</a>
          <a href="/safety">Safety</a>
          <a href={repositoryUrl}>Source</a>
          <small>build {buildSha.slice(0, 10)}</small>
        </div>
      </footer>
    </div>
  );
}
