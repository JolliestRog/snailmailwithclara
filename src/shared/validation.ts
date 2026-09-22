import type {
  LandingBlock,
  LandingContent,
  MailSettings,
  PostalAddress,
} from "./types";

const USERNAME = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const COUNTRY = /^[A-Z]{2}$/;

export function validUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME.test(value);
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validCountry(value: unknown): value is string {
  return typeof value === "string" && COUNTRY.test(value);
}

export function validAddress(value: unknown): value is PostalAddress {
  if (!value || typeof value !== "object") return false;
  const address = value as Record<string, unknown>;
  return (
    cleanText(address.recipient, 120).length > 0 &&
    cleanText(address.addressLine1, 160).length > 0 &&
    cleanText(address.locality, 120).length > 0 &&
    validCountry(address.countryCode)
  );
}

export function validMailSettings(value: unknown): value is MailSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.rouletteEnabled === "boolean" &&
    typeof settings.anonymousEnabled === "boolean" &&
    Number.isInteger(settings.monthlyLimit) &&
    Number(settings.monthlyLimit) >= 1 &&
    Number(settings.monthlyLimit) <= 4 &&
    ["domestic", "selected", "anywhere"].includes(
      String(settings.destinationMode),
    ) &&
    Array.isArray(settings.destinationCountries) &&
    settings.destinationCountries.every(validCountry) &&
    typeof settings.paused === "boolean"
  );
}

function validBlock(block: unknown): block is LandingBlock {
  if (!block || typeof block !== "object") return false;
  const b = block as Record<string, unknown>;
  if (
    typeof b.id !== "string" ||
    b.id.length > 80 ||
    typeof b.type !== "string"
  )
    return false;
  switch (b.type) {
    case "hero":
      return ["eyebrow", "title", "body", "ctaLabel", "ctaHref"].every(
        (key) => typeof b[key] === "string",
      );
    case "text":
    case "announcement":
      return typeof b.title === "string" && typeof b.body === "string";
    case "image":
      return (
        typeof b.src === "string" &&
        typeof b.alt === "string" &&
        b.alt.trim().length > 0
      );
    case "faq":
      return (
        typeof b.title === "string" &&
        Array.isArray(b.items) &&
        b.items.length <= 20
      );
    case "links":
      return (
        typeof b.title === "string" &&
        Array.isArray(b.links) &&
        b.links.length <= 12
      );
    case "divider":
      return true;
    default:
      return false;
  }
}

export function validLandingContent(value: unknown): value is LandingContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Record<string, unknown>;
  return (
    ["signal-red", "acid-yellow", "midnight-blue"].includes(
      String(content.theme),
    ) &&
    Array.isArray(content.blocks) &&
    content.blocks.length <= 30 &&
    content.blocks.every(validBlock) &&
    JSON.stringify(content).length <= 100_000
  );
}

export function safeExternalHref(value: string): string | null {
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
