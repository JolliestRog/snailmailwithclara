import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cleanText, validUsername } from "../shared/validation";
import type { CipherEnvelope, Role } from "../shared/types";
import type { Env } from "./context";
import { audit, optionalUser } from "./context";
import {
  HttpError,
  body,
  clearSessionCookie,
  json,
  sessionCookie,
} from "./http";
import {
  fromBase64Url,
  id,
  isoAfter,
  parseJson,
  randomToken,
  sha256,
} from "./security";

interface InviteRow {
  id: string;
  roles_json: string;
  expires_at: string;
  used_at: string | null;
}

interface ChallengeRow {
  challenge: string;
  metadata_json: string;
  expires_at: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports_json: string;
  username: string;
  status: string;
}

function validCipherEnvelope(value: unknown): value is CipherEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    record.algorithm === "AES-256-GCM" &&
    typeof record.iv === "string" &&
    typeof record.ciphertext === "string" &&
    (record.salt === undefined || typeof record.salt === "string")
  );
}

async function invitationFor(
  env: Env,
  token: string,
  username: string,
): Promise<{ id: string; roles: Role[]; bootstrap: boolean }> {
  const tokenHash = await sha256(token);
  if (
    env.BOOTSTRAP_TOKEN_HASH &&
    tokenHash === env.BOOTSTRAP_TOKEN_HASH &&
    username === (env.BOOTSTRAP_USERNAME ?? "clara").toLowerCase()
  ) {
    const used = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'bootstrap_used'",
    ).first<{ value: string }>();
    if (used?.value === "true")
      throw new HttpError(
        410,
        "The Clara bootstrap invitation has already been used.",
      );
    return {
      id: "bootstrap-clara",
      roles: ["member", "curator", "moderator"],
      bootstrap: true,
    };
  }

  const invite = await env.DB.prepare(
    "SELECT id, roles_json, expires_at, used_at FROM invitations WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<InviteRow>();
  if (
    !invite ||
    invite.used_at ||
    invite.expires_at <= new Date().toISOString()
  ) {
    throw new HttpError(400, "That invitation is invalid or expired.");
  }
  return {
    id: invite.id,
    roles: parseJson<Role[]>(invite.roles_json, ["member"]),
    bootstrap: false,
  };
}

export async function registrationOptions(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = await body<{
    inviteToken?: string;
    username?: string;
    displayName?: string;
  }>(request);
  const username = cleanText(input.username, 24).toLowerCase();
  const displayName = cleanText(input.displayName, 80);
  const inviteToken = cleanText(input.inviteToken, 256);
  if (!validUsername(username))
    throw new HttpError(
      400,
      "Use 3–24 lowercase letters, numbers, dashes, or underscores.",
    );
  if (!inviteToken) throw new HttpError(400, "An invitation is required.");
  const existing = await env.DB.prepare(
    "SELECT 1 FROM users WHERE username = ?",
  )
    .bind(username)
    .first();
  if (existing) throw new HttpError(409, "That username is already taken.");
  const invite = await invitationFor(env, inviteToken, username);
  const userId = id("usr");
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: username,
    userDisplayName: displayName || username,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  const ceremonyId = id("ceremony");
  await env.DB.prepare(
    "INSERT INTO webauthn_challenges (id, kind, challenge, metadata_json, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      ceremonyId,
      "register",
      options.challenge,
      JSON.stringify({
        userId,
        username,
        displayName,
        inviteId: invite.id,
        roles: invite.roles,
        bootstrap: invite.bootstrap,
      }),
      isoAfter(5 * 60_000),
    )
    .run();
  return json({ ceremonyId, options });
}

export async function registrationVerify(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = await body<{
    ceremonyId?: string;
    response?: RegistrationResponseJSON;
    inviteToken?: string;
    publicEncryptionKey?: string;
    encryptedPrivateKey?: CipherEnvelope;
    recoveryWrappedMasterKey?: CipherEnvelope;
  }>(request);
  if (!input.ceremonyId || !input.response || !input.inviteToken)
    throw new HttpError(400, "Incomplete registration.");
  if (
    typeof input.publicEncryptionKey !== "string" ||
    !validCipherEnvelope(input.encryptedPrivateKey) ||
    !validCipherEnvelope(input.recoveryWrappedMasterKey)
  ) {
    throw new HttpError(400, "Invalid encrypted vault.");
  }
  const challenge = await env.DB.prepare(
    "SELECT challenge, metadata_json, expires_at FROM webauthn_challenges WHERE id = ? AND kind = 'register'",
  )
    .bind(input.ceremonyId)
    .first<ChallengeRow>();
  if (!challenge || challenge.expires_at <= new Date().toISOString())
    throw new HttpError(400, "Registration expired.");
  const metadata = parseJson<{
    userId: string;
    username: string;
    displayName: string;
    inviteId: string;
    roles: Role[];
    bootstrap: boolean;
  }>(challenge.metadata_json, null as never);
  const invite = await invitationFor(env, input.inviteToken, metadata.username);
  if (invite.id !== metadata.inviteId)
    throw new HttpError(400, "Invitation mismatch.");

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true,
  });
  if (!verification.verified)
    throw new HttpError(400, "Passkey verification failed.");
  const credential = verification.registrationInfo.credential;
  const now = new Date().toISOString();
  const status = metadata.bootstrap ? "active" : "pending";
  const statements = [
    env.DB.prepare(
      "INSERT INTO invitation_redemptions (invitation_id, user_id) VALUES (?, ?)",
    ).bind(metadata.inviteId, metadata.userId),
    env.DB.prepare(
      `INSERT INTO users
       (id, username, display_name, status, roles_json, age_attested_at, public_encryption_key, encrypted_private_key_json, recovery_wrapped_master_key_json, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      metadata.userId,
      metadata.username,
      metadata.displayName || null,
      status,
      JSON.stringify(metadata.roles),
      now,
      input.publicEncryptionKey,
      JSON.stringify(input.encryptedPrivateKey),
      JSON.stringify(input.recoveryWrappedMasterKey),
      metadata.bootstrap ? now : null,
    ),
    env.DB.prepare(
      `INSERT INTO webauthn_credentials
       (id, user_id, public_key, counter, transports_json, device_type, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      credential.id,
      metadata.userId,
      credential.publicKey,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      verification.registrationInfo.credentialDeviceType,
      verification.registrationInfo.credentialBackedUp ? 1 : 0,
    ),
    env.DB.prepare("INSERT INTO mail_settings (user_id) VALUES (?)").bind(
      metadata.userId,
    ),
    env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(
      input.ceremonyId,
    ),
  ];
  if (metadata.bootstrap) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO app_settings (key, value) VALUES ('bootstrap_used', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP",
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE invitations SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL",
      ).bind(now, metadata.userId, metadata.inviteId),
    );
  }
  await env.DB.batch(statements);
  const token = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(await sha256(token), metadata.userId, isoAfter(14 * 24 * 60 * 60_000))
    .run();
  await audit(
    env,
    metadata.userId,
    "account.registered",
    "user",
    metadata.userId,
    { bootstrap: metadata.bootstrap },
  );
  return json(
    { ok: true, status, userId: metadata.userId },
    { status: 201, headers: { "set-cookie": sessionCookie(token) } },
  );
}

export async function loginOptions(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = await body<{ username?: string }>(request);
  const username = cleanText(input.username, 24).toLowerCase();
  if (!validUsername(username))
    throw new HttpError(400, "Enter your username.");
  const user = await env.DB.prepare(
    "SELECT id, status FROM users WHERE username = ?",
  )
    .bind(username)
    .first<{ id: string; status: string }>();
  if (!user || user.status === "deleted")
    throw new HttpError(404, "No account was found for that username.");
  const credentials = await env.DB.prepare(
    "SELECT id, transports_json FROM webauthn_credentials WHERE user_id = ?",
  )
    .bind(user.id)
    .all<{ id: string; transports_json: string }>();
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: "required",
    allowCredentials: credentials.results.map((credential) => ({
      id: credential.id,
      transports: parseJson(credential.transports_json, []),
    })),
  });
  const ceremonyId = id("ceremony");
  await env.DB.prepare(
    "INSERT INTO webauthn_challenges (id, kind, challenge, metadata_json, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      ceremonyId,
      "login",
      options.challenge,
      JSON.stringify({ userId: user.id }),
      isoAfter(5 * 60_000),
    )
    .run();
  return json({ ceremonyId, options });
}

export async function loginVerify(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = await body<{
    ceremonyId?: string;
    response?: AuthenticationResponseJSON;
  }>(request);
  if (!input.ceremonyId || !input.response)
    throw new HttpError(400, "Incomplete sign-in.");
  const challenge = await env.DB.prepare(
    "SELECT challenge, metadata_json, expires_at FROM webauthn_challenges WHERE id = ? AND kind = 'login'",
  )
    .bind(input.ceremonyId)
    .first<ChallengeRow>();
  if (!challenge || challenge.expires_at <= new Date().toISOString())
    throw new HttpError(400, "Sign-in expired.");
  const credential = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.public_key, c.counter, c.transports_json, u.username, u.status
     FROM webauthn_credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
  )
    .bind(input.response.id)
    .first<CredentialRow>();
  if (!credential) throw new HttpError(400, "Unknown passkey.");
  const metadata = parseJson<{ userId: string }>(challenge.metadata_json, {
    userId: "",
  });
  if (metadata.userId !== credential.user_id)
    throw new HttpError(400, "Passkey does not belong to this account.");
  if (credential.status === "deleted")
    throw new HttpError(403, "This account has been deleted.");
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true,
    credential: {
      id: credential.id,
      publicKey: new Uint8Array(credential.public_key),
      counter: credential.counter,
      transports: parseJson(credential.transports_json, []),
    },
  });
  if (!verification.verified)
    throw new HttpError(400, "Passkey verification failed.");
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(verification.authenticationInfo.newCounter, credential.id),
    env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(
      input.ceremonyId,
    ),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).bind(
      await sha256(token),
      credential.user_id,
      isoAfter(14 * 24 * 60 * 60_000),
    ),
  ]);
  return json(
    { ok: true, status: credential.status },
    { headers: { "set-cookie": sessionCookie(token) } },
  );
}

export async function recoveryOptions(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = await body<{ username?: string; token?: string }>(request);
  const username = cleanText(input.username, 24).toLowerCase();
  const tokenHash = await sha256(cleanText(input.token, 256));
  const recovery = await env.DB.prepare(
    `SELECT r.id, r.user_id FROM recovery_invitations r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > CURRENT_TIMESTAMP
       AND u.username = ? AND u.status = 'active'`,
  )
    .bind(tokenHash, username)
    .first<{ id: string; user_id: string }>();
  if (!recovery)
    throw new HttpError(400, "That recovery link is invalid or expired.");
  const credentials = await env.DB.prepare(
    "SELECT id, transports_json FROM webauthn_credentials WHERE user_id = ?",
  )
    .bind(recovery.user_id)
    .all<{ id: string; transports_json: string }>();
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: username,
    userDisplayName: username,
    userID: new TextEncoder().encode(recovery.user_id),
    attestationType: "none",
    excludeCredentials: credentials.results.map((credential) => ({
      id: credential.id,
      transports: parseJson(credential.transports_json, []),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  const ceremonyId = id("ceremony");
  await env.DB.prepare(
    "INSERT INTO webauthn_challenges (id, kind, challenge, metadata_json, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      ceremonyId,
      "recover",
      options.challenge,
      JSON.stringify({
        recoveryId: recovery.id,
        userId: recovery.user_id,
        tokenHash,
      }),
      isoAfter(5 * 60_000),
    )
    .run();
  return json({ ceremonyId, options });
}

export async function recoveryVerify(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = await body<{
    ceremonyId?: string;
    token?: string;
    response?: RegistrationResponseJSON;
  }>(request);
  if (!input.ceremonyId || !input.token || !input.response)
    throw new HttpError(400, "Incomplete recovery.");
  const challenge = await env.DB.prepare(
    "SELECT challenge, metadata_json, expires_at FROM webauthn_challenges WHERE id = ? AND kind = 'recover'",
  )
    .bind(input.ceremonyId)
    .first<ChallengeRow>();
  if (!challenge || challenge.expires_at <= new Date().toISOString())
    throw new HttpError(400, "Recovery ceremony expired.");
  const metadata = parseJson<{
    recoveryId: string;
    userId: string;
    tokenHash: string;
  }>(challenge.metadata_json, null as never);
  if ((await sha256(input.token)) !== metadata.tokenHash)
    throw new HttpError(400, "Recovery token mismatch.");
  const recovery = await env.DB.prepare(
    "SELECT 1 FROM recovery_invitations WHERE id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
  )
    .bind(metadata.recoveryId, metadata.tokenHash)
    .first();
  if (!recovery)
    throw new HttpError(400, "That recovery link is invalid or expired.");
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true,
  });
  if (!verification.verified)
    throw new HttpError(400, "New passkey verification failed.");
  const credential = verification.registrationInfo.credential;
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO recovery_redemptions (recovery_id, credential_id) VALUES (?, ?)",
    ).bind(metadata.recoveryId, credential.id),
    env.DB.prepare(
      `INSERT INTO webauthn_credentials
       (id, user_id, public_key, counter, transports_json, device_type, backed_up) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      credential.id,
      metadata.userId,
      credential.publicKey,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      verification.registrationInfo.credentialDeviceType,
      verification.registrationInfo.credentialBackedUp ? 1 : 0,
    ),
    env.DB.prepare(
      "UPDATE recovery_invitations SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL",
    ).bind(metadata.recoveryId),
    env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(
      input.ceremonyId,
    ),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).bind(
      await sha256(token),
      metadata.userId,
      isoAfter(14 * 24 * 60 * 60_000),
    ),
  ]);
  await audit(
    env,
    metadata.userId,
    "account_recovery.completed",
    "user",
    metadata.userId,
    { recoveryId: metadata.recoveryId },
  );
  return json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie(token) } },
  );
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)smwc_session=([^;]+)/)?.[1];
  if (token)
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(decodeURIComponent(token)))
      .run();
  return json(
    { ok: true },
    { headers: { "set-cookie": clearSessionCookie() } },
  );
}

export async function authStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await optionalUser(request, env);
  return json({ authenticated: Boolean(user), user });
}
