import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ChevronDown, Plus, Pencil, X } from "lucide-react";
import { errorMessage, native, type Status } from "./backend";
import "./ChapterIndex.css";

export type Chapter = {
  id: string;
  bookId: string;
  title: string;
  position: number;
  status: Status;
  note: string;
  pageStart: number | null;
  pageEnd: number | null;
  documentRevision: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Index = { chapters: Chapter[]; documentRevision: string | null };
export type ChapterDraft = {
  dirty: boolean;
  id: string;
  title: string;
  position: string;
  status: Status;
  note: string;
  pageStart: string;
  pageEnd: string;
  documentRevision: string | null;
  expectedVersion: number;
};
export default function ChapterIndex({
  bookId,
  documentRevision,
  pageCount,
  currentPage,
  onJump,
  onActivity,
  chapterDraft,
  onChapterDraftChange,
}: {
  bookId: string;
  documentRevision: string | null;
  pageCount?: number;
  currentPage?: number;
  onJump: (page: number) => void;
  onActivity?: () => void;
  chapterDraft?: ChapterDraft | null;
  onChapterDraftChange?: (
    draft: ChapterDraft | null,
    expected?: ChapterDraft,
  ) => void;
}) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [localDraft, setLocalDraft] = useState<ChapterDraft | null>(null);
  const draft = chapterDraft === undefined ? localDraft : chapterDraft;
  const [open, setOpen] = useState(draft !== null);
  function setDraft(next: ChapterDraft | null, expected?: ChapterDraft) {
    if (onChapterDraftChange) onChapterDraftChange(next, expected);
    else
      setLocalDraft((previous) =>
        expected && previous !== expected ? previous : next,
      );
  }
  const [loading, setLoading] = useState(native);
  const [ready, setReady] = useState(!native);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setChapters([]);
    setNotice("");
    setError("");
    setReady(!native);
    if (!native) return;
    setLoading(true);
    invoke<Index>("get_book_chapters", { bookId })
      .then((index) => {
        if (live) {
          setChapters(index.chapters);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [bookId, retry]);
  function edit(chapter?: Chapter) {
    setNotice("");
    setDraft(
      chapter
        ? {
            dirty: false,
            id: chapter.id,
            title: chapter.title,
            position: String(chapter.position),
            status: chapter.status,
            note: chapter.note,
            pageStart:
              chapter.pageStart === null ? "" : String(chapter.pageStart),
            pageEnd: chapter.pageEnd === null ? "" : String(chapter.pageEnd),
            documentRevision: chapter.documentRevision,
            expectedVersion: chapter.version,
          }
        : {
            dirty: true,
            id: crypto.randomUUID(),
            title: "",
            position: String(
              Math.min(
                10000,
                Math.max(0, ...chapters.map((c) => c.position)) + 1,
              ),
            ),
            status: "not_started",
            note: "",
            pageStart: "",
            pageEnd: "",
            documentRevision: null,
            expectedVersion: 0,
          },
    );
    setOpen(true);
  }
  function update(values: Partial<ChapterDraft>) {
    setDraft(draft ? { ...draft, ...values, dirty: true } : null);
  }
  async function save() {
    if (!draft || !ready) return;
    setError("");
    setNotice("");
    const position = Number(draft.position);
    const start = draft.pageStart === "" ? null : Number(draft.pageStart);
    const end = draft.pageEnd === "" ? null : Number(draft.pageEnd);
    const old = chapters.find((c) => c.id === draft.id);
    const mappingChanged =
      old?.pageStart !== start ||
      old?.pageEnd !== end ||
      old?.documentRevision !== draft.documentRevision;
    if (
      !draft.title.trim() ||
      draft.title.length > 200 ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > 10000
    ) {
      setError(
        "Enter a chapter title and a whole-number order from 1 to 10000.",
      );
      return;
    }
    if (
      (start === null) !== (end === null) ||
      (start !== null &&
        (!Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          end! < start ||
          end! > 100000 ||
          !draft.documentRevision ||
          (mappingChanged &&
            (!pageCount ||
              end! > pageCount ||
              draft.documentRevision !== documentRevision))))
    ) {
      setError(
        "Enter both PDF page numbers within the current PDF, or clear the mapping.",
      );
      return;
    }
    if (new TextEncoder().encode(draft.note).length > 20000) {
      setError("Keep the chapter note under 20 KB.");
      return;
    }
    setBusy(true);
    try {
      const { dirty: _dirty, ...fields } = draft;
      const input = {
        ...fields,
        title: draft.title.trim(),
        position,
        pageStart: start,
        pageEnd: end,
        documentRevision: start === null ? null : draft.documentRevision,
      };
      if (native) {
        const index = await invoke<Index>("save_book_chapter", {
          bookId,
          input,
        });
        setChapters(index.chapters);
      } else {
        const now = new Date().toISOString();
        const next: Chapter = {
          ...input,
          bookId,
          version: draft.expectedVersion + 1,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
        };
        setChapters((previous) =>
          [...previous.filter((c) => c.id !== next.id), next].sort(
            (a, b) => a.position - b.position || a.id.localeCompare(b.id),
          ),
        );
      }
      setDraft(null, draft);
      setNotice(
        native
          ? "Chapter saved on this device."
          : "Chapter saved in this preview. Leaving the reader clears saved preview chapters.",
      );
      onActivity?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const read = chapters.filter((c) => c.status === "read").length;
  return (
    <section className="chapter-index" aria-label="Manual chapter index">
      <div className="chapter-index-heading">
        <button
          className="chapter-index-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <BookOpen size={15} />
          <strong>Chapter index</strong>
          <span>
            {chapters.length
              ? `${read}/${chapters.length} read`
              : "Add your own"}
          </span>
          <ChevronDown size={14} />
        </button>
        <button
          className="icon-label"
          disabled={!ready || busy || draft !== null || chapters.length >= 500}
          onClick={() => edit()}
        >
          <Plus size={14} />
          Add chapter
        </button>
      </div>
      {open && (
        <div className="chapter-index-body">
          <p className="chapter-index-help">
            Enter titles from your edition’s contents. Chapters, reading status,
            and notes are separate from roadmap topic checks.{" "}
            {native
              ? "Saved privately on this device."
              : "Browser preview: saved chapters clear when you leave this reader. Unsaved drafts stay while the app is open."}
          </p>
          {loading && <p role="status">Loading chapter index…</p>}
          {error && (
            <div className="chapter-error" role="alert">
              {error}{" "}
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setRetry((v) => v + 1);
                }}
              >
                {draft ? "Discard draft and reload" : "Reload index"}
              </button>
            </div>
          )}
          {notice && (
            <p className="chapter-notice" role="status">
              {notice}
            </p>
          )}
          {!loading && !chapters.length && !draft && (
            <p className="chapter-index-empty">
              No chapter titles have been added. You can build the index before
              importing a PDF.
            </p>
          )}
          <div className="chapter-list">
            {chapters.map((c) => {
              const currentMap =
                c.documentRevision !== null &&
                c.documentRevision === documentRevision;
              const jumpable =
                currentMap &&
                !!pageCount &&
                c.pageStart !== null &&
                c.pageEnd !== null &&
                c.pageEnd <= pageCount;
              return (
                <div className="chapter-row" key={c.id}>
                  <span className="chapter-order">{c.position}</span>
                  <div>
                    <strong>{c.title}</strong>
                    <span className={`chapter-state ${c.status}`}>
                      {c.status === "read"
                        ? "Read · self-reported"
                        : c.status === "reading"
                          ? "Reading"
                          : "Not started"}
                      {c.note ? " · Note saved" : ""}
                    </span>
                    {c.pageStart !== null && (
                      <button
                        className="chapter-page-link"
                        disabled={!jumpable || busy}
                        onClick={() => onJump(c.pageStart!)}
                      >
                        {`PDF pages ${c.pageStart}–${c.pageEnd}`}
                        {!currentMap
                          ? " · Re-map after PDF import"
                          : !jumpable
                            ? " · Check page range"
                            : " · Open"}
                      </button>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Edit chapter ${c.title}`}
                    disabled={busy || draft !== null}
                    onClick={() => edit(c)}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          {draft && (
            <form
              className="chapter-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="chapter-form-heading">
                <strong>
                  {draft.expectedVersion ? "Edit chapter" : "Add chapter"}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel chapter edit"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <label>
                Chapter title
                <input
                  aria-label="Chapter title"
                  maxLength={200}
                  required
                  value={draft.title}
                  disabled={busy}
                  placeholder="Copy the title from your edition"
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <div className="chapter-form-pair">
                <label>
                  Order
                  <input
                    aria-label="Chapter order"
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    required
                    value={draft.position}
                    disabled={busy}
                    onChange={(e) => update({ position: e.target.value })}
                  />
                </label>
                <label>
                  Reading status
                  <select
                    aria-label="Chapter reading status"
                    value={draft.status}
                    disabled={busy}
                    onChange={(e) =>
                      update({ status: e.target.value as Status })
                    }
                  >
                    <option value="not_started">Not started</option>
                    <option value="reading">Reading</option>
                    <option value="read">Read · self-reported</option>
                  </select>
                </label>
              </div>
              <label>
                Chapter notes
                <textarea
                  aria-label="Chapter notes"
                  value={draft.note}
                  disabled={busy}
                  placeholder="Your observations, questions, and experiments…"
                  onChange={(e) => update({ note: e.target.value })}
                />
              </label>
              <fieldset disabled={busy || !pageCount || !documentRevision}>
                <legend>PDF page mapping (optional)</legend>
                <p>
                  Use PDF page numbers shown by the reader, which may differ
                  from printed page labels.
                </p>
                <div className="chapter-form-pair">
                  <label>
                    First PDF page
                    <input
                      aria-label="Chapter first PDF page"
                      type="number"
                      min={1}
                      max={pageCount}
                      step={1}
                      value={draft.pageStart}
                      onChange={(e) =>
                        update({ pageStart: e.target.value, documentRevision })
                      }
                    />
                  </label>
                  <label>
                    Last PDF page
                    <input
                      aria-label="Chapter last PDF page"
                      type="number"
                      min={1}
                      max={pageCount}
                      step={1}
                      value={draft.pageEnd}
                      onChange={(e) =>
                        update({ pageEnd: e.target.value, documentRevision })
                      }
                    />
                  </label>
                </div>
                {currentPage && (
                  <button
                    className="icon-label"
                    type="button"
                    onClick={() =>
                      update({
                        pageStart: String(currentPage),
                        pageEnd: String(currentPage),
                        documentRevision,
                      })
                    }
                  >
                    Use current PDF page ({currentPage})
                  </button>
                )}
              </fieldset>
              {!pageCount && (
                <small>
                  Import a PDF to map pages. Titles, status, and notes work
                  without one.
                </small>
              )}
              {draft.pageStart &&
                draft.documentRevision !== documentRevision && (
                  <p className="chapter-map-warning">
                    This page mapping belongs to a different PDF. Re-enter the
                    range for this copy, or clear it. Reading progress and notes
                    stay with the chapter.
                  </p>
                )}
              {draft.pageStart && (
                <button
                  type="button"
                  className="icon-label"
                  disabled={busy}
                  onClick={() =>
                    update({
                      pageStart: "",
                      pageEnd: "",
                      documentRevision: null,
                    })
                  }
                >
                  Clear page mapping
                </button>
              )}
              <div className="chapter-form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Save chapter"}
                </button>
              </div>
              <small>
                Drafts stay while this app is open. Save to keep them on disk.
                Chapter reading is self-reported. It does not award XP or verify
                mastery. Editing a title or order keeps its notes and progress.
              </small>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
