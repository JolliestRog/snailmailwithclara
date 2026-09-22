import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useState } from "react";
import { api, jsonBody } from "../api";

export function RecoveryPanel({
  onAuthenticated,
}: {
  onAuthenticated: () => Promise<void>;
}) {
  const params = new URLSearchParams(location.search);
  const [username, setUsername] = useState(params.get("username") ?? "");
  const [token, setToken] = useState(params.get("token") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function recover(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const start = await api<{
        ceremonyId: string;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>("/api/auth/recovery/options", {
        method: "POST",
        ...jsonBody({ username, token }),
      });
      const response = await startRegistration({ optionsJSON: start.options });
      await api("/api/auth/recovery/verify", {
        method: "POST",
        ...jsonBody({ ceremonyId: start.ceremonyId, token, response }),
      });
      await onAuthenticated();
      location.href = "/app";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recovery failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <p className="kicker">Moderator re-verified</p>
      <h2>Create a replacement passkey</h2>
      <p>
        This restores account access only. You will still need your private
        recovery code to unlock postal data on this device.
      </p>
      <form onSubmit={recover}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            required
          />
        </label>
        <label>
          One-time recovery token
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>
          {busy ? "Creating…" : "Create new passkey"}
        </button>
      </form>
    </section>
  );
}
