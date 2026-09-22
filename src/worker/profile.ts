import type {
  CipherEnvelope,
  CurrentUser,
  MailSettings,
  PublicProfile,
  Role,
  VaultRecord,
} from "../shared/types";
import {
  cleanText,
  validCountry,
  validMailSettings,
} from "../shared/validation";
import type { AuthUser, Env } from "./context";
import { audit, optionalUser, requireUser } from "./context";
import { HttpError, body, json } from "./http";
import { parseJson } from "./security";

interface MeRow {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  country_code: string | null;
  status: CurrentUser["status"];
  roles_json: string;
  email: string | null;
  email_notifications: number;
  public_encryption_key: string;
  roulette_enabled: number;
  anonymous_enabled: number;
  monthly_limit: 1 | 2 | 3 | 4;
  destination_mode: MailSettings["destinationMode"];
  destination_countries_json: string;
  paused: number;
  has_address: number;
}

function settingsFrom(row: MeRow): MailSettings {
  return {
    rouletteEnabled: Boolean(row.roulette_enabled),
    anonymousEnabled: Boolean(row.anonymous_enabled),
    monthlyLimit: row.monthly_limit,
    destinationMode: row.destination_mode,
    destinationCountries: parseJson(row.destination_countries_json, []),
    paused: Boolean(row.paused),
  };
}

export async function me(request: Request, env: Env): Promise<Response> {
  const session = await optionalUser(request, env);
  if (!session) return json({ user: null });
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.bio, u.country_code, u.status, u.roles_json,
            u.email, u.email_notifications, u.public_encryption_key,
            s.roulette_enabled, s.anonymous_enabled, s.monthly_limit, s.destination_mode,
            s.destination_countries_json, s.paused,
            CASE WHEN v.user_id IS NULL THEN 0 ELSE 1 END AS has_address
     FROM users u
     JOIN mail_settings s ON s.user_id = u.id
     LEFT JOIN address_vaults v ON v.user_id = u.id
     WHERE u.id = ?`,
  )
    .bind(session.id)
    .first<MeRow>();
  if (!row) return json({ user: null });
  const user: CurrentUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    countryCode: row.country_code ?? null,
    publicEncryptionKey: row.public_encryption_key,
    status: row.status,
    roles: parseJson<Role[]>(row.roles_json, ["member"]),
    email: row.email,
    emailNotifications: Boolean(row.email_notifications),
    settings: settingsFrom(row),
    hasAddress: Boolean(row.has_address),
  };
  return json({ user });
}

export async function updateProfile(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    displayName?: string;
    bio?: string;
    countryCode?: string;
    email?: string | null;
    emailNotifications?: boolean;
  }>(request);
  const displayName = cleanText(input.displayName, 80) || null;
  const bio = cleanText(input.bio, 280) || null;
  const countryCode = String(input.countryCode ?? "").toUpperCase();
  if (!validCountry(countryCode))
    throw new HttpError(400, "Choose a two-letter country code.");
  const email = cleanText(input.email, 254).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new HttpError(400, "Enter a valid email address.");
  await env.DB.prepare(
    `UPDATE users SET display_name = ?, bio = ?, country_code = ?, email = ?, email_notifications = ? WHERE id = ?`,
  )
    .bind(
      displayName,
      bio,
      countryCode,
      email,
      email && input.emailNotifications ? 1 : 0,
      user.id,
    )
    .run();
  await audit(env, user.id, "profile.updated", "user", user.id);
  return json({ ok: true });
}

export async function updateSettings(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  const settings = await body<MailSettings>(request);
  if (!validMailSettings(settings))
    throw new HttpError(400, "Invalid mail settings.");
  const hasAddress = await env.DB.prepare(
    "SELECT 1 FROM address_vaults WHERE user_id = ?",
  )
    .bind(user.id)
    .first();
  if (settings.rouletteEnabled && !hasAddress)
    throw new HttpError(
      400,
      "Add an encrypted address before enabling roulette.",
    );
  await env.DB.prepare(
    `UPDATE mail_settings SET roulette_enabled = ?, anonymous_enabled = ?, monthly_limit = ?,
      destination_mode = ?, destination_countries_json = ?, paused = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
  )
    .bind(
      settings.rouletteEnabled ? 1 : 0,
      settings.anonymousEnabled ? 1 : 0,
      settings.monthlyLimit,
      settings.destinationMode,
      JSON.stringify(settings.destinationCountries),
      settings.paused ? 1 : 0,
      user.id,
    )
    .run();
  await audit(env, user.id, "mail_settings.updated", "user", user.id);
  return json({ ok: true });
}

export async function directory(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const query = cleanText(new URL(request.url).searchParams.get("q"), 40);
  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.bio, u.country_code, u.public_encryption_key
     FROM users u
     WHERE u.status = 'active' AND u.id <> ?
       AND (u.username LIKE ? OR COALESCE(u.display_name, '') LIKE ?)
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
       )
     ORDER BY u.username LIMIT 40`,
  )
    .bind(user.id, `%${query}%`, `%${query}%`, user.id, user.id)
    .all<Record<string, string | null>>();
  const profiles: PublicProfile[] = rows.results.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    countryCode: row.country_code ?? null,
    publicEncryptionKey: String(row.public_encryption_key),
  }));
  return json({ profiles });
}

export async function getVault(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const row = await env.DB.prepare(
    `SELECT u.public_encryption_key, u.encrypted_private_key_json, u.recovery_wrapped_master_key_json,
            v.encrypted_address_json
     FROM users u LEFT JOIN address_vaults v ON v.user_id = u.id WHERE u.id = ?`,
  )
    .bind(user.id)
    .first<{
      public_encryption_key: string;
      encrypted_private_key_json: string;
      recovery_wrapped_master_key_json: string;
      encrypted_address_json: string | null;
    }>();
  if (!row) throw new HttpError(404, "Vault not found.");
  const vault: VaultRecord = {
    publicEncryptionKey: row.public_encryption_key,
    encryptedPrivateKey: parseJson<CipherEnvelope>(
      row.encrypted_private_key_json,
      null as never,
    ),
    recoveryWrappedMasterKey: parseJson<CipherEnvelope>(
      row.recovery_wrapped_master_key_json,
      null as never,
    ),
    encryptedAddress: parseJson<CipherEnvelope | null>(
      row.encrypted_address_json,
      null,
    ),
  };
  return json({ vault });
}

function looksEncrypted(value: unknown): value is CipherEnvelope {
  const envelope = value as Partial<CipherEnvelope> | null;
  return Boolean(
    envelope &&
    envelope.version === 1 &&
    envelope.algorithm === "AES-256-GCM" &&
    typeof envelope.iv === "string" &&
    typeof envelope.ciphertext === "string",
  );
}

export async function putVault(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await body<{
    encryptedAddress?: CipherEnvelope;
    countryCode?: string;
  }>(request);
  const countryCode = String(input.countryCode ?? "").toUpperCase();
  if (!looksEncrypted(input.encryptedAddress) || !validCountry(countryCode))
    throw new HttpError(400, "Invalid encrypted address.");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO address_vaults (user_id, encrypted_address_json) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET encrypted_address_json = excluded.encrypted_address_json, updated_at = CURRENT_TIMESTAMP`,
    ).bind(user.id, JSON.stringify(input.encryptedAddress)),
    env.DB.prepare("UPDATE users SET country_code = ? WHERE id = ?").bind(
      countryCode,
      user.id,
    ),
  ]);
  await audit(env, user.id, "address_vault.updated", "user", user.id, {
    countryCode,
  });
  return json({ ok: true });
}

export async function blockMember(
  request: Request,
  env: Env,
  targetId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  if (user.id === targetId)
    throw new HttpError(400, "You cannot block yourself.");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
    ).bind(user.id, targetId),
    env.DB.prepare(
      `UPDATE mail_requests SET status = 'cancelled' WHERE status = 'pending'
       AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`,
    ).bind(user.id, targetId, targetId, user.id),
    env.DB.prepare(
      `UPDATE address_grants SET status = 'revoked', encrypted_address_json = '{}'
       WHERE status = 'active' AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`,
    ).bind(user.id, targetId, targetId, user.id),
  ]);
  await audit(env, user.id, "member.blocked", "user", targetId);
  return json({ ok: true });
}

export async function deleteAccount(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireUser(request, env);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET status = 'deleted', username = 'deleted-' || id, display_name = NULL, bio = NULL,
       email = NULL, email_notifications = 0, public_encryption_key = '', encrypted_private_key_json = '{}',
       recovery_wrapped_master_key_json = '{}', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(user.id),
    env.DB.prepare("DELETE FROM address_vaults WHERE user_id = ?").bind(
      user.id,
    ),
    env.DB.prepare(
      "UPDATE address_grants SET status = 'revoked', encrypted_address_json = '{}' WHERE sender_id = ? OR recipient_id = ?",
    ).bind(user.id, user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  await audit(env, null, "account.deleted", "user", user.id);
  return json({ ok: true });
}

export function ensureActive(user: AuthUser): void {
  if (user.status !== "active")
    throw new HttpError(403, "Active membership required.");
}
