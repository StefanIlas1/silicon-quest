import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { errorMessage, native } from "./backend";
import PdfPageNotes from "./PdfPageNotes";
import "./PdfAnnotations.css";

export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PdfTextSelection = {
  page: number;
  quote: string;
  rects: HighlightRect[];
};
export type PdfAnnotation = {
  id: string;
  page: number;
  body: string;
  quote: string | null;
  rects: HighlightRect[];
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Draft = {
  id: string;
  page: number;
  body: string;
  quote: string | null;
  rects: HighlightRect[];
  expectedVersion: number;
};
// Unsaved work survives reader/book navigation for this app session. Saved notes
// live only in SQLite; no document contents enter browser localStorage.
const drafts = new Map<string, Draft>();
export function hasAnnotationDrafts() {
  return drafts.size > 0;
}
export function annotationDraftCount() {
  return drafts.size;
}
export function discardAnnotationDrafts() {
  drafts.clear();
}
export default function PdfAnnotations({
  bookId,
  documentRevision,
  page,
  pageCount,
  onNavigate,
  onError,
  disabled = false,
  selection = null,
  onAnnotationsChange,
  onSelectionClear,
}: {
  bookId: string;
  documentRevision: string;
  page: number;
  pageCount: number;
  onNavigate: (page: number) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  selection?: PdfTextSelection | null;
  onAnnotationsChange?: (annotations: PdfAnnotation[]) => void;
  onSelectionClear?: () => void;
}) {
  const scope = `${bookId}:${documentRevision}`;
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [draft, setDraftState] = useState<Draft | null>(
    () => drafts.get(scope) ?? null,
  );
  const [open, setOpen] = useState(() => drafts.has(scope));
  const [ready, setReady] = useState(!native);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const availabilityId = useId();
  const unavailableReason = !native
    ? "Open the desktop app to save page notes and highlights locally."
    : !ready
      ? error
        ? "Annotations are unavailable until saved notes can be loaded."
        : "Loading annotations…"
      : disabled
        ? "Wait for the PDF import to finish before adding annotations."
        : busy
          ? "Saving annotations…"
          : draft
            ? "Save or discard your current draft in Annotations to add another note or highlight."
            : "";
  const onChange = useRef(onAnnotationsChange);
  onChange.current = onAnnotationsChange;
  useEffect(() => {
    onChange.current?.(annotations);
  }, [annotations]);
  const live = useRef(true);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  function setDraft(next: Draft | null) {
    if (next) drafts.set(scope, next);
    else drafts.delete(scope);
    setDraftState(next);
  }
  useEffect(() => {
    let active = true;
    setAnnotations([]);
    setDraftState(drafts.get(scope) ?? null);
    setOpen(drafts.has(scope));
    setRemoveId(null);
    setError("");
    setNotice("");
    setReady(!native);
    if (native)
      invoke<PdfAnnotation[]>("get_pdf_annotations", {
        bookId,
        documentRevision,
      })
        .then((result) => {
          if (active) {
            setAnnotations(result);
            setReady(true);
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
    };
  }, [scope, retry]);
  function edit(annotation?: PdfAnnotation) {
    setDraft(
      annotation
        ? {
            id: annotation.id,
            page: annotation.page,
            body: annotation.body,
            quote: annotation.quote,
            rects: annotation.rects,
            expectedVersion: annotation.version,
          }
        : {
            id: crypto.randomUUID(),
            page,
            body: "",
            quote: null,
            rects: [],
            expectedVersion: 0,
          },
    );
    setNotice("");
    setError("");
    setOpen(true);
  }
  function highlight() {
    if (!selection) return;
    setDraft({
      id: crypto.randomUUID(),
      page: selection.page,
      body: "",
      quote: selection.quote,
      rects: selection.rects,
      expectedVersion: 0,
    });
    setOpen(true);
    setError("");
    setNotice("");
    onSelectionClear?.();
  }
  async function save() {
    if (!draft || busy || disabled || !ready) return;
    const submitted = draft;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!native)
        throw new Error(
          "Open the desktop app to save PDF annotations locally.",
        );
      const result = await invoke<PdfAnnotation[]>("save_pdf_annotation", {
        bookId,
        documentRevision,
        input: submitted,
      });
      // Remove only the submitted draft, including after navigating away.
      if (drafts.get(scope) === submitted) drafts.delete(scope);
      if (live.current && currentScope.current === scope) {
        setAnnotations(result);
        setDraftState(null);
        setNotice("Annotation saved locally.");
      }
    } catch (e) {
      if (live.current && currentScope.current === scope) {
        const message = errorMessage(e);
        setError(message);
        onError?.(message);
      }
    } finally {
      if (live.current && currentScope.current === scope) setBusy(false);
    }
  }
  async function remove(annotation: PdfAnnotation) {
    if (busy || disabled || !ready) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await invoke<PdfAnnotation[]>("remove_pdf_annotation", {
        bookId,
        documentRevision,
        annotationId: annotation.id,
        expectedVersion: annotation.version,
      });
      if (live.current && currentScope.current === scope) {
        setAnnotations(result);
        setRemoveId(null);
        setNotice("Annotation removed.");
      }
    } catch (e) {
      if (live.current && currentScope.current === scope) {
        const message = errorMessage(e);
        setError(message);
        onError?.(message);
      }
    } finally {
      if (live.current && currentScope.current === scope) setBusy(false);
    }
  }
  return (
    <section className="pdf-annotations" aria-label="PDF annotations">
      <div className="annotation-heading">
        <button
          className="annotation-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <MessageSquare size={15} /> Annotations{" "}
          <span>{annotations.length}</span>
        </button>
        <button
          className="secondary-button"
          disabled={!native || !ready || busy || disabled || draft !== null}
          aria-describedby={unavailableReason ? availabilityId : undefined}
          onClick={() => edit()}
        >
          <Plus size={14} /> Note on page {page}
        </button>
      </div>
      {selection && (
        <div className="annotation-selection">
          <span>Selected text on page {selection.page}</span>
          <button
            className="primary-button"
            disabled={!native || !ready || disabled || busy || draft !== null}
            aria-describedby={unavailableReason ? availabilityId : undefined}
            onClick={highlight}
          >
            Highlight selected text
          </button>
        </div>
      )}
      {unavailableReason && (
        <p
          className="annotation-availability"
          id={availabilityId}
          role="status"
        >
          {unavailableReason}
          {draft && !open && (
            <button className="annotation-jump" onClick={() => setOpen(true)}>
              Continue draft
            </button>
          )}
        </p>
      )}
      {error && (
        <div className="annotation-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setRetry(retry + 1)}
          >
            Reload saved notes
          </button>
          {draft && (
            <small>
              Your draft stays here. Copy it before discarding if a saved note
              changed.
            </small>
          )}
        </div>
      )}
      {open && (
        <div className="annotation-content">
          <small>
            Notes are linked to this PDF's page numbers and saved privately
            alongside it. Highlights use selectable PDF text; scanned image
            pages may have no text to select. Notes and highlights do not alter
            the PDF.
          </small>
          {notice && <p role="status">{notice}</p>}
          {draft && (
            <form
              className="annotation-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label htmlFor={`annotation-${draft.id}`}>
                {draft.expectedVersion ? "Edit note" : "New note"} · PDF page{" "}
                {draft.page}
              </label>
              {draft.quote && <blockquote>{draft.quote}</blockquote>}
              <textarea
                id={`annotation-${draft.id}`}
                aria-label="Page note"
                rows={4}
                value={draft.body}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="What do you want to remember or test?"
              />
              <small>
                Draft kept during this app session. Save before quitting.
                Maximum 20 KB.
              </small>
              <div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    busy ||
                    disabled ||
                    !ready ||
                    !native ||
                    (!draft.body.trim() && !draft.quote) ||
                    new TextEncoder().encode(draft.body).length > 20000
                  }
                >
                  {busy
                    ? "Saving…"
                    : draft.quote
                      ? "Save highlight"
                      : "Save page note"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  <X size={13} /> Discard draft
                </button>
              </div>
            </form>
          )}
          {ready && annotations.length === 0 && !draft && (
            <p className="annotations-empty">
              No page notes yet. Add one on the page you are reading.
            </p>
          )}
          <div className="annotation-list">
            {annotations.map((annotation) => (
              <article
                className={
                  annotation.page === page
                    ? "annotation-row current"
                    : "annotation-row"
                }
                key={annotation.id}
              >
                <div className="annotation-row-heading">
                  <button
                    className="annotation-jump"
                    disabled={disabled || busy || annotation.page > pageCount}
                    onClick={() => onNavigate(annotation.page)}
                  >
                    PDF page {annotation.page}
                    {annotation.page > pageCount ? " · unavailable" : ""}
                  </button>
                  <div>
                    <button
                      className="icon-button"
                      aria-label={`Edit note on page ${annotation.page}`}
                      disabled={disabled || busy || draft !== null}
                      onClick={() => edit(annotation)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove note on page ${annotation.page}`}
                      disabled={disabled || busy || draft !== null}
                      onClick={() => setRemoveId(annotation.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {annotation.quote && (
                  <blockquote>{annotation.quote}</blockquote>
                )}
                {annotation.body && <p>{annotation.body}</p>}
                {removeId === annotation.id && (
                  <div className="annotation-remove">
                    <span>Remove this note?</span>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void remove(annotation)}
                    >
                      Remove note
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setRemoveId(null)}
                    >
                      Keep note
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function PdfAnnotationOverlay({
  annotations,
  page,
}: {
  annotations: PdfAnnotation[];
  page: number;
}) {
  return (
    <>
      <div className="pdf-annotation-overlay" aria-hidden="true">
        {annotations
          .filter((annotation) => annotation.page === page && annotation.quote)
          .flatMap((annotation) =>
            annotation.rects.map((rect, index) => (
              <span
                key={`${annotation.id}-${index}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            )),
          )}
      </div>
      <PdfPageNotes annotations={annotations} page={page} />
    </>
  );
}
