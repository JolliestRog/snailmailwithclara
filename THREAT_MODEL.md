# Threat model

## Protected assets

The highest-sensitivity asset is the complete postal label: legal or delivery name, organization, street lines, locality, region, postal code, and country. Private request notes and recovery material are also protected client-side.

Public or server-visible data includes usernames, optional display names and bios, account status, public encryption keys, country codes, roles, settings, timestamps, request/match identifiers, match pairings, blocks, reports, audit events, and optional notification email addresses.

## Intended guarantees

- A database dump, backup leak, ordinary moderator account, or log leak does not reveal complete postal addresses.
- Only a member holding the local/recovered master key can decrypt their vault and X25519 private key.
- A grant encrypted to one sender cannot be decrypted with another member's private key.
- Modified ciphertext is rejected by AES-GCM authentication.
- Targeted address release requires an explicit recipient action. Roulette release requires prior opt-in and occurs only after the recipient unlocks the browser vault.
- Moderator access and anonymous-sender revelation occur only through report workflows and are audited at the application layer.

## Explicit non-guarantees

- A sender can retain a label after it is displayed. Expiration removes in-app access, not human memory or screenshots.
- Infrastructure sees routing metadata and can correlate anonymous roulette accounts. “Anonymous” means hidden from the recipient.
- A malicious deployment owner could serve JavaScript that captures plaintext during entry or decryption. Public source, protected CI, a displayed commit hash, CSP, and no third-party scripts make this harder and more detectable; they do not eliminate it.
- Malware, browser extensions, screenshots, compromised devices, shoulder surfing, physical mail theft, handwriting, postmarks, and return addresses are outside the cryptographic boundary.
- Optional email is visible to the server and delivery provider.
- Moderators perform real-world membership verification. Cryptography does not prove membership or good intent.

## Abuse controls

- Adults only; invitation plus moderator approval.
- Identified targeted requests, explicit approval, five-per-week rate limit, blocks, and grant revocation.
- Opt-in roulette, monthly incoming limits, one open outgoing draw, 90-day pair exclusion, and anonymous opt-out.
- Reports map anonymous match IDs back to accountable accounts for moderators. Viewing the report queue creates an audit event.
- Suspensions invalidate sessions. Blocking cancels pending requests and wipes active grant ciphertext between that pair.

## Cryptographic construction

- Random 256-bit account master key.
- AES-256-GCM address and private-key envelopes with fresh 96-bit nonces.
- Random X25519 identity keypair per account.
- Ephemeral X25519 sender key, HKDF-SHA-256 domain separation, and AES-256-GCM for shared grants and notes.
- Random 256-bit recovery code; HKDF-SHA-256 derives a key that wraps the master key.
- Known browsers store the master key encrypted by a non-exportable Web Crypto device key in IndexedDB.

Every envelope carries an explicit version. Do not change formats or dependencies without test vectors, migration design, and security review.

## Incident response

1. Freeze deployments and invitations.
2. Preserve metadata-only audit records without collecting plaintext.
3. Revoke affected sessions and Cloudflare/API credentials.
4. Identify the last trustworthy deployed commit and publish the discrepancy.
5. Tell affected members what metadata or ciphertext was exposed and whether malicious client code could have observed plaintext.
6. Rotate operational secrets. Do not claim that rotating server secrets changes already disclosed postal addresses.
7. Publish a post-incident report and remediation before reopening.
