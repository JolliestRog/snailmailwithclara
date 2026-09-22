import { useState } from "react";
import type { CurrentUser, MailSettings } from "../../shared/types";
import { api, jsonBody } from "../api";
import { PageTitle } from "./VaultPage";

export function SettingsPage({
  user,
  refreshUser,
}: {
  user: CurrentUser;
  refreshUser: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<MailSettings>(user.settings);
  const [profile, setProfile] = useState({
    displayName: user.displayName ?? "",
    bio: user.bio ?? "",
    countryCode: user.countryCode ?? "US",
    email: user.email ?? "",
    emailNotifications: user.emailNotifications,
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/profile", { method: "PATCH", ...jsonBody(profile) });
      await api("/api/settings", { method: "PATCH", ...jsonBody(settings) });
      setNotice("Settings saved.");
      await refreshUser();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  }
  async function deleteAccount() {
    if (
      !confirm(
        "Delete your account and encrypted address? This cannot be undone.",
      )
    )
      return;
    await api("/api/account", { method: "DELETE" });
    location.href = "/";
  }
  return (
    <>
      <PageTitle kicker="You decide" title="Profile and mail settings" />
      <form className="panel settings-form" onSubmit={save}>
        <h2>Member profile</h2>
        <label>
          Display name
          <input
            value={profile.displayName}
            onChange={(e) =>
              setProfile({ ...profile, displayName: e.target.value })
            }
          />
        </label>
        <label>
          Short bio
          <textarea
            value={profile.bio}
            maxLength={280}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
          />
        </label>
        <label>
          Country code
          <input
            value={profile.countryCode}
            maxLength={2}
            onChange={(e) =>
              setProfile({
                ...profile,
                countryCode: e.target.value.toUpperCase(),
              })
            }
          />
        </label>
        <h2>Mail roulette</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.rouletteEnabled}
            onChange={(e) =>
              setSettings({ ...settings, rouletteEnabled: e.target.checked })
            }
          />{" "}
          Accept random mail matches
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.anonymousEnabled}
            onChange={(e) =>
              setSettings({ ...settings, anonymousEnabled: e.target.checked })
            }
          />{" "}
          Allow anonymous roulette senders
        </label>
        <label>
          Incoming roulette limit
          <select
            value={settings.monthlyLimit}
            onChange={(e) =>
              setSettings({
                ...settings,
                monthlyLimit: Number(e.target.value) as 1 | 2 | 3 | 4,
              })
            }
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} per 30 days
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.paused}
            onChange={(e) =>
              setSettings({ ...settings, paused: e.target.checked })
            }
          />{" "}
          Pause all incoming mail activity
        </label>
        <h2>Optional alerts</h2>
        <label>
          Email address
          <input
            type="email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={profile.emailNotifications}
            onChange={(e) =>
              setProfile({ ...profile, emailNotifications: e.target.checked })
            }
          />{" "}
          Send generic email reminders
        </label>
        <p className="fine-print">
          Email is not part of the encrypted vault. Alert messages never include
          names, requests, or addresses.
        </p>
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <button>Save settings</button>
      </form>
      <section className="danger-zone">
        <h2>Delete account</h2>
        <p>
          Disables sign-in, revokes active grants, and removes profile and vault
          data.
        </p>
        <button className="danger" onClick={deleteAccount}>
          Delete my account
        </button>
      </section>
    </>
  );
}
