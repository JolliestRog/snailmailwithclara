export function PolicyPage({ page }: { page: "privacy" | "safety" | "how" }) {
  if (page === "privacy") {
    return (
      <main id="main" className="policy-page">
        <p className="kicker">Plain-language privacy</p>
        <h1>What the site can—and cannot—see</h1>
        <h2>Postal addresses</h2>
        <p>
          Your address is encrypted in your browser. The service stores
          ciphertext and cannot provide a forgotten recovery code.
        </p>
        <h2>Routing metadata</h2>
        <p>
          The service does know account IDs, country codes, request and match
          pairings, timestamps, moderation status, and an optional notification
          email. Anonymous roulette is anonymous to the recipient, not to the
          infrastructure.
        </p>
        <h2>Address grants</h2>
        <p>
          An approved sender can read, copy, print, or photograph the address
          during the mailing window. Technology cannot make them forget it
          afterward.
        </p>
        <h2>Content and retention</h2>
        <p>
          Letter contents never pass through this service. Expired address
          grants are erased within 24 hours; recent match identifiers remain for
          90 days to prevent repetitive matching; audit and moderation records
          remain for one year.
        </p>
        <h2>Operator limitation</h2>
        <p>
          Public source and browser encryption reduce trust, but whoever
          controls a web deployment could theoretically serve changed
          JavaScript. The deployed commit is shown on every page so changes are
          inspectable.
        </p>
      </main>
    );
  }
  if (page === "safety") {
    return (
      <main id="main" className="policy-page">
        <p className="kicker">Consent before surprise</p>
        <h1>Community safety</h1>
        <p>
          This is an adults-only, invitation-based group. Targeted requests
          identify the sender and require approval. Roulette requires an
          explicit opt-in.
        </p>
        <h2>Use the controls</h2>
        <p>
          You can pause mail, deny requests without explanation, block another
          member, report a match, or delete your account. Blocking revokes
          active in-app grants, though previously copied addresses cannot be
          recalled.
        </p>
        <h2>Anonymous does not mean unaccountable</h2>
        <p>
          Recipients do not see an anonymous roulette sender’s username. A
          report reveals the accountable account to moderators and records that
          access in the audit log.
        </p>
        <h2>Immediate danger</h2>
        <p>
          Do not use this site for emergencies. Preserve the envelope and
          contact local authorities or postal inspectors when physical mail
          contains a credible threat.
        </p>
      </main>
    );
  }
  return (
    <main id="main" className="policy-page">
      <p className="kicker">Two ways to send</p>
      <h1>How it works</h1>
      <h2>Ask someone directly</h2>
      <p>
        Find a username, send an identified request, and wait. If they approve,
        you receive an encrypted address grant for 14 days or until you mark the
        letter sent.
      </p>
      <h2>Try mail roulette</h2>
      <p>
        Choose signed or anonymous mail and the countries you can post to. The
        app finds an opted-in member, who releases their encrypted label the
        next time they unlock the app.
      </p>
      <h2>Keep the address vault safe</h2>
      <p>
        Save the recovery code offline. Moderators can restore account access
        after re-verification, but they cannot recover encrypted postal data.
      </p>
    </main>
  );
}
