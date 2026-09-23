export type Role = "member" | "moderator" | "curator" | "security_admin";
export type AccountStatus = "pending" | "active" | "suspended" | "deleted";

export interface CipherEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  salt?: string;
}

export interface SealedEnvelope extends CipherEnvelope {
  keyAgreement: "X25519-HKDF-SHA256";
  ephemeralPublicKey: string;
}

export interface PostalAddress {
  recipient: string;
  organization?: string;
  addressLine1: string;
  addressLine2?: string;
  locality: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
}

export interface MailSettings {
  rouletteEnabled: boolean;
  anonymousEnabled: boolean;
  monthlyLimit: 1 | 2 | 3 | 4;
  destinationMode: "domestic" | "selected" | "anywhere";
  destinationCountries: string[];
  paused: boolean;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  countryCode: string | null;
  publicEncryptionKey: string;
}

export interface CurrentUser extends PublicProfile {
  status: AccountStatus;
  roles: Role[];
  email: string | null;
  emailNotifications: boolean;
  newsletterOptIn: boolean;
  settings: MailSettings;
  hasAddress: boolean;
}

export type AnnouncementKind = "newsletter" | "update" | "warning";

export interface AccountMessage {
  id: string;
  source: "personal" | "announcement";
  kind: "welcome" | "system" | AnnouncementKind;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  author?: string | null;
}

export type FeedbackKind = "bug" | "feature";

export interface FeedbackView {
  id: string;
  kind: FeedbackKind;
  title: string;
  summary: string;
  steps: string;
  expected: string;
  actual: string;
  pageUrl: string;
  buildSha: string;
  status: "new" | "triaged" | "planned" | "closed";
  n8nStatus: "pending" | "delivered" | "failed";
  createdAt: string;
  username?: string;
}

export type LandingTheme = "signal-red" | "acid-yellow" | "midnight-blue";
export type LandingBlock =
  | {
      id: string;
      type: "hero";
      eyebrow: string;
      title: string;
      body: string;
      ctaLabel: string;
      ctaHref: string;
    }
  | { id: string; type: "text"; title: string; body: string }
  | { id: string; type: "announcement"; title: string; body: string }
  | { id: string; type: "image"; src: string; alt: string; caption?: string }
  | {
      id: string;
      type: "faq";
      title: string;
      items: Array<{ question: string; answer: string }>;
    }
  | {
      id: string;
      type: "links";
      title: string;
      links: Array<{ label: string; href: string }>;
    }
  | { id: string; type: "divider" };

export interface LandingContent {
  theme: LandingTheme;
  blocks: LandingBlock[];
}

export interface VaultRecord {
  publicEncryptionKey: string;
  encryptedPrivateKey: CipherEnvelope;
  recoveryWrappedMasterKey: CipherEnvelope;
  encryptedAddress: CipherEnvelope | null;
}

export interface MailRequestView {
  id: string;
  direction: "incoming" | "outgoing";
  status: string;
  createdAt: string;
  expiresAt: string;
  member: PublicProfile;
  encryptedNote: SealedEnvelope | null;
}

export interface RouletteMatchView {
  id: string;
  direction: "incoming" | "outgoing";
  anonymous: boolean;
  status: string;
  createdAt: string;
  releaseExpiresAt: string;
  member: PublicProfile | null;
  releasePublicKey?: string;
}

export interface GrantView {
  id: string;
  recipient: Pick<PublicProfile, "username" | "displayName">;
  sourceType: "targeted" | "roulette";
  status: string;
  expiresAt: string;
  encryptedAddress: SealedEnvelope;
}

export interface ApiErrorShape {
  error: string;
  code?: string;
}
