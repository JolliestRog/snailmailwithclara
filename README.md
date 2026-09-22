# Snail Mail with Clara

An invitation-only, consent-first physical-mail exchange for Clara's Riot Fest community. Postal addresses are encrypted in each member's browser and are never sent to the application as plaintext.

## What works

- Passkey registration and sign-in with single-use invitations and moderator approval.
- A client-encrypted international address vault with an offline recovery code.
- Identified, recipient-approved targeted requests with optional end-to-end encrypted notes.
- Opt-in signed or anonymous roulette, geographic filtering, monthly limits, and recent-pair avoidance.
- Fourteen-day encrypted address grants, automatic expiration, blocking, reporting, and deletion.
- Clara's block-based landing-page editor with drafts, preview, publishing, image metadata removal, and revision history.
- Separate member, moderator, curator, and security-administrator capabilities with an audit trail.
- A Cloudflare Worker, D1 database, R2 media bucket, scheduled cleanup, and a React frontend on one origin.

## Security boundary

The database contains ciphertext rather than readable postal addresses. A recipient's browser decrypts its vault and re-encrypts an approved label directly to the sender's X25519 public key. Letter contents never enter the app.

This is not magic anonymity. An approved sender can copy an address. Cloudflare and an operator can observe account IDs, country codes, match pairings, timestamps, moderation records, and optional email addresses. The operator of any website could theoretically deploy altered JavaScript; the footer exposes the deployed commit so members can compare it to this repository. Read [THREAT_MODEL.md](THREAT_MODEL.md) before operating the service.

## Local development

Requirements: Node 22+, npm 11+, and a Cloudflare account for remote deployment.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

For local WebAuthn, keep `RP_ID=localhost` and use the exact local origin printed by Vite. Passkeys require a secure context; browsers treat localhost as secure.

Run all verification:

```sh
npm run check
```

## Production deployment

1. Create the resources:

   ```sh
   npx wrangler d1 create snailmailwithclara
   npx wrangler r2 bucket create snailmailwithclara-media
   ```

2. Put the returned D1 database ID and the final public GitHub URL in `wrangler.jsonc`, then apply migrations:

   ```sh
   npm run db:migrate:remote
   ```

3. Generate Clara's one-time bootstrap invitation:

   ```sh
   npm run bootstrap -- clara
   npx wrangler secret put BOOTSTRAP_USERNAME
   npx wrangler secret put BOOTSTRAP_TOKEN_HASH
   ```

   Give only the generated invitation URL to Clara. Its token is never stored by the service, and it stops working after her account is created. That account receives `member`, `curator`, and `moderator`, but not `security_admin`.

4. Set `BUILD_SHA` to the commit being deployed, deploy from a protected GitHub environment, and attach `snailmailwithclara.facey.page` as the Worker custom domain:

   ```sh
   npm run build
   npx wrangler deploy --var BUILD_SHA:$(git rev-parse HEAD)
   ```

5. Have Clara create a normal invitation for the separate operator account. After approval, grant `security_admin` once through D1 from an authenticated operational console. Do not give Clara this role by default.

6. Enable branch protection, required CI, deployment environment approval, Cloudflare account MFA, and least-privilege API tokens before inviting members.

The `ORIGIN` and `RP_ID` production values are intentionally fixed to the custom domain. Changing the hostname requires an explicit passkey migration plan.

## Operational checklist

- Review open reports and pending applications from named individual moderator accounts.
- Never request a member's recovery code or postal address.
- Treat generated invitation links as secrets until redeemed.
- Review dependency alerts and the deployed commit regularly.
- Confirm the scheduled cleanup trigger is running daily.
- Keep logs body-free and do not add session replay, ad tracking, arbitrary third-party scripts, or analytics tags.
- Commission an independent cryptography and abuse-flow review before the full community launch.

## License

AGPL-3.0-only. The public deployment must provide the corresponding source for modified versions.
