import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useState } from "react";
import { api, jsonBody } from "../api";
import { initializeVault, saveMasterToDevice } from "../crypto";

interface Props {
  mode: "login" | "join";
  onAuthenticated: () => Promise<void>;
}

export function AuthPanel({ mode, onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteToken, setInviteToken] = useState(
    new URLSearchParams(location.search).get("invite") ?? "",
  );
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  async function register() {
    if (!age) throw new Error("You must confirm that you are at least 18.");
    const start = await api<{
      ceremonyId: string;
      options: PublicKeyCredentialCreationOptionsJSON;
    }>("/api/auth/register/options", {
      method: "POST",
      ...jsonBody({ inviteToken, username, displayName }),
    });
    const response = await startRegistration({ optionsJSON: start.options });
    const vault = await initializeVault();
    const result = await api<{ userId: string; status: string }>(
      "/api/auth/register/verify",
      {
        method: "POST",
        ...jsonBody({
          ceremonyId: start.ceremonyId,
          response,
          inviteToken,
          publicEncryptionKey: vault.publicEncryptionKey,
          encryptedPrivateKey: vault.encryptedPrivateKey,
          recoveryWrappedMasterKey: vault.recoveryWrappedMasterKey,
        }),
      },
    );
    await saveMasterToDevice(result.userId, vault.masterKey);
    setRecoveryCode(vault.recoveryCode);
    await onAuthenticated();
  }

  async function login() {
    const start = await api<{
      ceremonyId: string;
      options: PublicKeyCredentialRequestOptionsJSON;
    }>("/api/auth/login/options", {
      method: "POST",
      ...jsonBody({ username }),
    });
    const response = await startAuthentication({ optionsJSON: start.options });
    await api("/api/auth/login/verify", {
      method: "POST",
      ...jsonBody({ ceremonyId: start.ceremonyId, response }),
    });
    await onAuthenticated();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await (mode === "join" ? register() : login());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <section
        className="auth-card recovery-card"
        aria-labelledby="recovery-title"
      >
        <p className="kicker">One important thing</p>
        <h2 id="recovery-title">Save your recovery code</h2>
        <p>
          This is the only way to unlock your address on a new device. Clara and
          the moderators cannot recover it.
        </p>
        <code className="recovery-code">{recoveryCode}</code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(recoveryCode)}
        >
          Copy recovery code
        </button>
        <a className="button secondary" href="/app">
          I saved it—open my account
        </a>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="kicker">
        {mode === "join" ? "Invitation required" : "Welcome back"}
      </p>
      <h2 id="auth-title">
        {mode === "join" ? "Join the mail club" : "Sign in with a passkey"}
      </h2>
      <form onSubmit={submit}>
        {mode === "join" && (
          <>
            <label>
              Invitation code
              <input
                value={inviteToken}
                onChange={(event) => setInviteToken(event.target.value)}
                required
              />
            </label>
            <label>
              First name or display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
              />
            </label>
          </>
        )}
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9_-]{2,23}"
            autoComplete="username webauthn"
            required
          />
        </label>
        {mode === "join" && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={age}
              onChange={(event) => setAge(event.target.checked)}
            />{" "}
            I am at least 18 years old.
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy}>
          {busy
            ? "Working…"
            : mode === "join"
              ? "Create passkey and join"
              : "Use my passkey"}
        </button>
      </form>
      <p className="fine-print">
        Passkeys protect the account. A separate recovery code protects the
        encrypted address vault.
      </p>
      {mode === "login" && (
        <p className="fine-print">
          Lost every passkey? Ask a moderator to re-verify you and issue a
          30-minute recovery link.
        </p>
      )}
    </section>
  );
}
