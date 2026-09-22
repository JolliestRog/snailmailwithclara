import { x25519 } from "@noble/curves/ed25519.js";
import type {
  CipherEnvelope,
  PostalAddress,
  SealedEnvelope,
  VaultRecord,
} from "../shared/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function buffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importAes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buffer(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  salt?: string,
): Promise<CipherEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buffer(iv) },
    key,
    buffer(plaintext),
  );
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    ...(salt ? { salt } : {}),
  };
}

async function decryptBytes(
  key: CryptoKey,
  envelope: CipherEnvelope,
): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buffer(base64ToBytes(envelope.iv)) },
    key,
    buffer(base64ToBytes(envelope.ciphertext)),
  );
  return new Uint8Array(plaintext);
}

async function recoveryKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(code.trim());
  } catch {
    throw new Error("That recovery code is not valid.");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    buffer(raw),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: buffer(salt),
      info: buffer(encoder.encode("snailmailwithclara-recovery-v1")),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function sharedKey(
  secret: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    buffer(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: buffer(salt),
      info: buffer(encoder.encode("snailmailwithclara-sealed-v1")),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface NewVault {
  publicEncryptionKey: string;
  encryptedPrivateKey: CipherEnvelope;
  recoveryWrappedMasterKey: CipherEnvelope;
  recoveryCode: string;
  masterKey: Uint8Array;
}

export async function initializeVault(): Promise<NewVault> {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const secretKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(secretKey);
  const encryptedPrivateKey = await encryptBytes(
    await importAes(masterKey),
    secretKey,
  );
  const recoveryRaw = crypto.getRandomValues(new Uint8Array(32));
  const recoveryCode = bytesToBase64(recoveryRaw);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recoveryWrappedMasterKey = await encryptBytes(
    await recoveryKey(recoveryCode, salt),
    masterKey,
    bytesToBase64(salt),
  );
  return {
    publicEncryptionKey: bytesToBase64(publicKey),
    encryptedPrivateKey,
    recoveryWrappedMasterKey,
    recoveryCode,
    masterKey,
  };
}

interface DeviceVault {
  key: CryptoKey;
  wrappedMaster: CipherEnvelope;
}

function vaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("snailmailwithclara-vault", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await vaultDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("keys").objectStore("keys").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await vaultDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("keys", "readwrite")
      .objectStore("keys")
      .put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveMasterToDevice(
  userId: string,
  masterKey: Uint8Array,
): Promise<void> {
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const wrappedMaster = await encryptBytes(deviceKey, masterKey);
  await idbPut(userId, { key: deviceKey, wrappedMaster } satisfies DeviceVault);
}

export async function loadMasterFromDevice(
  userId: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const stored = await idbGet<DeviceVault>(userId);
  if (!stored) return null;
  try {
    return await decryptBytes(stored.key, stored.wrappedMaster);
  } catch {
    return null;
  }
}

export async function recoverMaster(
  userId: string,
  vault: VaultRecord,
  code: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!vault.recoveryWrappedMasterKey.salt)
    throw new Error("Recovery data is incomplete.");
  const key = await recoveryKey(
    code,
    base64ToBytes(vault.recoveryWrappedMasterKey.salt),
  );
  let master: Uint8Array<ArrayBuffer>;
  try {
    master = await decryptBytes(key, vault.recoveryWrappedMasterKey);
  } catch {
    throw new Error("That recovery code could not unlock this vault.");
  }
  await saveMasterToDevice(userId, master);
  return master;
}

export async function encryptAddress(
  master: Uint8Array,
  address: PostalAddress,
): Promise<CipherEnvelope> {
  return encryptBytes(
    await importAes(master),
    encoder.encode(JSON.stringify(address)),
  );
}

export async function decryptAddress(
  master: Uint8Array,
  envelope: CipherEnvelope,
): Promise<PostalAddress> {
  return JSON.parse(
    decoder.decode(await decryptBytes(await importAes(master), envelope)),
  ) as PostalAddress;
}

export async function sealJson(
  publicKey: string,
  value: unknown,
): Promise<SealedEnvelope> {
  const ephemeral = x25519.keygen();
  const secret = x25519.getSharedSecret(
    ephemeral.secretKey,
    base64ToBytes(publicKey),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = await encryptBytes(
    await sharedKey(secret, salt),
    encoder.encode(JSON.stringify(value)),
    bytesToBase64(salt),
  );
  return {
    ...encrypted,
    keyAgreement: "X25519-HKDF-SHA256",
    ephemeralPublicKey: bytesToBase64(ephemeral.publicKey),
  };
}

export async function openSealed(
  master: Uint8Array,
  encryptedPrivateKey: CipherEnvelope,
  envelope: SealedEnvelope,
): Promise<unknown> {
  if (!envelope.salt) throw new Error("Encrypted message is incomplete.");
  const privateKey = await decryptBytes(
    await importAes(master),
    encryptedPrivateKey,
  );
  const secret = x25519.getSharedSecret(
    privateKey,
    base64ToBytes(envelope.ephemeralPublicKey),
  );
  const plaintext = await decryptBytes(
    await sharedKey(secret, base64ToBytes(envelope.salt)),
    envelope,
  );
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}

export function formatAddress(address: PostalAddress): string {
  return [
    address.recipient,
    address.organization,
    address.addressLine1,
    address.addressLine2,
    [address.locality, address.region, address.postalCode]
      .filter(Boolean)
      .join(" "),
    address.countryCode,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function prepareLandingImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Image conversion failed.")),
      "image/webp",
      0.86,
    ),
  );
  return new File([blob], "landing.webp", { type: "image/webp" });
}
