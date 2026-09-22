import ReactMarkdown from "react-markdown";
import type { LandingBlock, LandingContent } from "../../shared/types";
import { safeExternalHref } from "../../shared/validation";

function Block({ block }: { block: LandingBlock }) {
  switch (block.type) {
    case "hero":
      return (
        <section className="hero torn-edge">
          <p className="kicker">{block.eyebrow}</p>
          <h1>{block.title}</h1>
          <ReactMarkdown>{block.body}</ReactMarkdown>
          {safeExternalHref(block.ctaHref) && (
            <a className="button hero-button" href={block.ctaHref}>
              {block.ctaLabel}
            </a>
          )}
          <div className="postmark" aria-hidden="true">
            CLARA
            <br />
            POST
          </div>
        </section>
      );
    case "text":
      return (
        <section className="landing-block text-block">
          <h2>{block.title}</h2>
          <ReactMarkdown>{block.body}</ReactMarkdown>
        </section>
      );
    case "announcement":
      return (
        <aside className="landing-block announcement">
          <p className="kicker">From Clara</p>
          <h2>{block.title}</h2>
          <ReactMarkdown>{block.body}</ReactMarkdown>
        </aside>
      );
    case "image":
      return (
        <figure className="landing-image">
          <img src={block.src} alt={block.alt} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    case "faq":
      return (
        <section className="landing-block">
          <h2>{block.title}</h2>
          <div className="faq-grid">
            {block.items.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case "links":
      return (
        <section className="landing-block">
          <h2>{block.title}</h2>
          <div className="link-list">
            {block.links.map(
              (link) =>
                safeExternalHref(link.href) && (
                  <a key={link.href} href={link.href}>
                    {link.label}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                ),
            )}
          </div>
        </section>
      );
    case "divider":
      return (
        <div className="stamp-divider" aria-hidden="true">
          ✦ ✉ ✦ ✉ ✦
        </div>
      );
  }
}

export function Landing({ content }: { content: LandingContent }) {
  return (
    <main id="main" className={`landing theme-${content.theme}`}>
      {content.blocks.map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </main>
  );
}

export function TrustStrip({ repositoryUrl }: { repositoryUrl: string }) {
  return (
    <section className="trust-strip" aria-label="Privacy summary">
      <div>
        <strong>Addresses</strong>
        <span>Encrypted in your browser</span>
      </div>
      <div>
        <strong>Membership</strong>
        <span>Invite and moderator approval</span>
      </div>
      <div>
        <strong>Code</strong>
        <span>
          <a href={repositoryUrl}>Public and inspectable</a>
        </span>
      </div>
    </section>
  );
}
