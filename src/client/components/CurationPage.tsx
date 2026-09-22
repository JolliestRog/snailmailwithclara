import { useEffect, useState } from "react";
import type {
  LandingBlock,
  LandingContent,
  LandingTheme,
} from "../../shared/types";
import { api, jsonBody } from "../api";
import { prepareLandingImage } from "../crypto";
import { Landing } from "./Landing";
import { PageTitle } from "./VaultPage";

function newBlock(type: LandingBlock["type"]): LandingBlock {
  const id = `${type}-${crypto.randomUUID()}`;
  switch (type) {
    case "text":
      return { id, type, title: "A new story", body: "Write something here." };
    case "announcement":
      return { id, type, title: "A note from Clara", body: "Share an update." };
    case "image":
      return { id, type, src: "", alt: "", caption: "" };
    case "faq":
      return {
        id,
        type,
        title: "Questions",
        items: [{ question: "A good question?", answer: "A clear answer." }],
      };
    case "links":
      return {
        id,
        type,
        title: "More places",
        links: [{ label: "A useful link", href: "https://" }],
      };
    case "divider":
      return { id, type };
    case "hero":
      return {
        id,
        type,
        eyebrow: "A tiny postal uprising",
        title: "Snail Mail with Clara",
        body: "Real letters, sent with care.",
        ctaLabel: "Join with an invite",
        ctaHref: "/join",
      };
  }
}

export function CurationPage() {
  const [content, setContent] = useState<LandingContent>({
    theme: "signal-red",
    blocks: [],
  });
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [revisions, setRevisions] = useState<
    Array<{ id: string; published_at: string; username?: string }>
  >([]);
  async function load() {
    const [result, history] = await Promise.all([
      api<{
        draft: { id: string; content: LandingContent } | null;
        published: { id: string; content: LandingContent };
      }>("/api/curation"),
      api<{
        revisions: Array<{
          id: string;
          published_at: string;
          username?: string;
        }>;
      }>("/api/curation/revisions"),
    ]);
    const selected = result.draft ?? result.published;
    setContent(selected.content);
    setRevisionId(result.draft?.id ?? null);
    setRevisions(history.revisions);
  }
  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Could not load the editor."),
    );
  }, []);
  function replace(index: number, block: LandingBlock) {
    setContent((current) => ({
      ...current,
      blocks: current.blocks.map((item, i) => (i === index ? block : item)),
    }));
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= content.blocks.length) return;
    const blocks = [...content.blocks];
    const [item] = blocks.splice(from, 1);
    if (!item) return;
    blocks.splice(to, 0, item);
    setContent({ ...content, blocks });
  }
  async function save() {
    setError("");
    try {
      const result = await api<{ revisionId: string }>("/api/curation/draft", {
        method: "PUT",
        ...jsonBody({ content }),
      });
      setRevisionId(result.revisionId);
      setNotice("Draft saved. Nothing public changed yet.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft.");
    }
  }
  async function publish() {
    let id = revisionId;
    if (!id) {
      const saved = await api<{ revisionId: string }>("/api/curation/draft", {
        method: "PUT",
        ...jsonBody({ content }),
      });
      id = saved.revisionId;
      setRevisionId(id);
    }
    if (!confirm("Publish this version to the public landing page?")) return;
    await api("/api/curation/publish", {
      method: "POST",
      ...jsonBody({ revisionId: id }),
    });
    setRevisionId(null);
    setNotice("The new landing page is live.");
    await load();
  }
  async function upload(file: File, index: number) {
    try {
      const prepared = await prepareLandingImage(file);
      const form = new FormData();
      form.append("image", prepared);
      const result = await api<{ src: string }>("/api/curation/images", {
        method: "POST",
        body: form,
      });
      const block = content.blocks[index];
      if (block?.type === "image")
        replace(index, { ...block, src: result.src });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image upload failed.");
    }
  }
  async function rollback(id: string) {
    if (!confirm("Publish this earlier revision as a new version?")) return;
    await api(`/api/curation/revisions/${id}/rollback`, { method: "POST" });
    setNotice("Earlier revision restored as a new published version.");
    await load();
  }
  if (preview)
    return (
      <div className="editor-preview">
        <div className="preview-bar">
          <strong>Draft preview</strong>
          <button onClick={() => setPreview(false)}>Back to editor</button>
        </div>
        <Landing content={content} />
      </div>
    );
  return (
    <>
      <PageTitle kicker="Clara’s creative room" title="Shape the landing page">
        <div className="button-row">
          <button className="secondary" onClick={() => setPreview(true)}>
            Preview
          </button>
          <button className="secondary" onClick={save}>
            Save draft
          </button>
          <button onClick={publish}>Publish</button>
        </div>
      </PageTitle>
      <p className="privacy-note notice">
        The privacy, safety, source, and sign-in navigation around this canvas
        is fixed. This editor cannot add scripts, embeds, tracking pixels, or
        arbitrary HTML.
      </p>
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <section className="editor-toolbar">
        <label>
          Palette
          <select
            value={content.theme}
            onChange={(e) =>
              setContent({ ...content, theme: e.target.value as LandingTheme })
            }
          >
            <option value="signal-red">Signal red</option>
            <option value="acid-yellow">Acid yellow</option>
            <option value="midnight-blue">Midnight blue</option>
          </select>
        </label>
        <label>
          Add a block
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                setContent({
                  ...content,
                  blocks: [
                    ...content.blocks,
                    newBlock(e.target.value as LandingBlock["type"]),
                  ],
                });
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            <option value="hero">Hero</option>
            <option value="text">Story</option>
            <option value="announcement">Announcement</option>
            <option value="image">Image</option>
            <option value="faq">FAQ</option>
            <option value="links">Links</option>
            <option value="divider">Divider</option>
          </select>
        </label>
      </section>
      <div className="editor-list">
        {content.blocks.map((block, index) => (
          <article
            className="editor-block"
            draggable
            key={block.id}
            onDragStart={(e) =>
              e.dataTransfer.setData("text/index", String(index))
            }
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              move(Number(e.dataTransfer.getData("text/index")), index);
            }}
          >
            <header>
              <span className="drag-handle" aria-label="Drag to reorder">
                ⠿
              </span>
              <strong>{block.type}</strong>
              <div>
                <button
                  className="icon-button"
                  onClick={() => move(index, index - 1)}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  onClick={() => move(index, index + 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  className="icon-button danger-text"
                  onClick={() =>
                    setContent({
                      ...content,
                      blocks: content.blocks.filter((_, i) => i !== index),
                    })
                  }
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            </header>
            <BlockFields
              block={block}
              update={(next) => replace(index, next)}
              upload={(file) => upload(file, index)}
            />
          </article>
        ))}
      </div>
      <section className="panel revision-history">
        <h2>Published history</h2>
        {revisions.map((revision) => (
          <div className="revision-row" key={revision.id}>
            <span>
              {new Date(revision.published_at).toLocaleString()} ·{" "}
              {revision.username ? `@${revision.username}` : "initial version"}
            </span>
            <button className="secondary" onClick={() => rollback(revision.id)}>
              Restore
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

function BlockFields({
  block,
  update,
  upload,
}: {
  block: LandingBlock;
  update: (block: LandingBlock) => void;
  upload: (file: File) => void;
}) {
  const text = (
    label: string,
    key: string,
    value: string,
    multiline = false,
  ) => (
    <label>
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) =>
            update({ ...block, [key]: e.target.value } as LandingBlock)
          }
        />
      ) : (
        <input
          value={value}
          onChange={(e) =>
            update({ ...block, [key]: e.target.value } as LandingBlock)
          }
        />
      )}
    </label>
  );
  if (block.type === "divider")
    return <p className="fine-print">A decorative postal divider.</p>;
  if (block.type === "hero")
    return (
      <div className="form-grid">
        {text("Eyebrow", "eyebrow", block.eyebrow)}
        {text("Title", "title", block.title)}
        <div className="wide">
          {text("Body (Markdown)", "body", block.body, true)}
        </div>
        {text("Button label", "ctaLabel", block.ctaLabel)}
        {text("Button link", "ctaHref", block.ctaHref)}
      </div>
    );
  if (block.type === "text" || block.type === "announcement")
    return (
      <>
        {text("Title", "title", block.title)}
        {text("Body (Markdown)", "body", block.body, true)}
      </>
    );
  if (block.type === "image")
    return (
      <div className="form-grid">
        <label>
          Upload image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
        {block.src && (
          <img
            className="editor-thumb"
            src={block.src}
            alt="Current upload preview"
          />
        )}
        {text("Alt text (required)", "alt", block.alt)}
        {text("Caption", "caption", block.caption ?? "")}
      </div>
    );
  if (block.type === "faq")
    return (
      <>
        {text("Section title", "title", block.title)}
        {block.items.map((item, i) => (
          <div className="repeat-row" key={i}>
            <input
              aria-label="Question"
              value={item.question}
              onChange={(e) =>
                update({
                  ...block,
                  items: block.items.map((x, n) =>
                    n === i ? { ...x, question: e.target.value } : x,
                  ),
                })
              }
            />
            <textarea
              aria-label="Answer"
              value={item.answer}
              onChange={(e) =>
                update({
                  ...block,
                  items: block.items.map((x, n) =>
                    n === i ? { ...x, answer: e.target.value } : x,
                  ),
                })
              }
            />
          </div>
        ))}
        <button
          className="secondary"
          onClick={() =>
            update({
              ...block,
              items: [
                ...block.items,
                { question: "Question?", answer: "Answer." },
              ],
            })
          }
        >
          Add question
        </button>
      </>
    );
  return (
    <>
      {text("Section title", "title", block.title)}
      {block.links.map((item, i) => (
        <div className="repeat-row" key={i}>
          <input
            aria-label="Link label"
            value={item.label}
            onChange={(e) =>
              update({
                ...block,
                links: block.links.map((x, n) =>
                  n === i ? { ...x, label: e.target.value } : x,
                ),
              })
            }
          />
          <input
            aria-label="Link URL"
            value={item.href}
            onChange={(e) =>
              update({
                ...block,
                links: block.links.map((x, n) =>
                  n === i ? { ...x, href: e.target.value } : x,
                ),
              })
            }
          />
        </div>
      ))}
      <button
        className="secondary"
        onClick={() =>
          update({
            ...block,
            links: [...block.links, { label: "Link", href: "https://" }],
          })
        }
      >
        Add link
      </button>
    </>
  );
}
