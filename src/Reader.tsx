import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Minus,
  Plus,
  FileText,
  Bookmark,
  Check,
  Trash2,
  X,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { native, errorMessage } from "./backend";
import ChapterIndex, { type ChapterDraft } from "./ChapterIndex";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
type DocumentInfo = {
  bookId: string;
  fileName: string;
  importedAt: string;
  documentRevision: string;
};
type PageBookmark = {
  id: string;
  page: number;
  label: string;
  createdAt: string;
};
type ReaderState = {
  page: number;
  documentRevision: string | null;
  bookmarks: PageBookmark[];
};
export default function Reader({
  bookId,
  title,
  onError,
  onActivity,
  chapterDraft,
  onChapterDraftChange,
}: {
  bookId: string;
  title: string;
  onError: (message: string) => void;
  onActivity?: () => void;
  chapterDraft?: ChapterDraft | null;
  onChapterDraftChange?: (
    draft: ChapterDraft | null,
    expected?: ChapterDraft,
  ) => void;
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(native);
  const [renderError, setRenderError] = useState("");
  const [retry, setRetry] = useState(0);
  const [bookmarks, setBookmarks] = useState<PageBookmark[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [stateReady, setStateReady] = useState(!native);
  const [pageSaveStatus, setPageSaveStatus] = useState<
    "saved" | "saving" | "failed" | "session" | "unavailable"
  >(native ? "unavailable" : "session");
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const writeVersion = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      doc?.destroy();
    },
    [doc],
  );
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setInfo(null);
    setPage(1);
    setBookmarks([]);
    setStateReady(!native);
    setPageSaveStatus(native ? "unavailable" : "session");
    setRenderError("");
    setInitialLoading(native);
    if (!native) return;
    (async () => {
      try {
        const meta = await invoke<DocumentInfo | null>("get_book_document", {
          bookId,
        });
        if (meta) {
          const bytes = await invoke<number[]>("get_book_pdf", {
            bookId,
            documentRevision: meta.documentRevision,
          });
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) })
            .promise;
          let readerState: ReaderState | null = null;
          try {
            readerState = await invoke<ReaderState>("get_book_reader_state", {
              bookId,
            });
            if (readerState.documentRevision !== meta.documentRevision)
              throw new Error(
                "The imported PDF changed. Reopen this book to restore its reading state.",
              );
          } catch (e) {
            if (alive) onError(`Reading state unavailable: ${errorMessage(e)}`);
          }
          if (alive) {
            setInfo(meta);
            if (readerState?.documentRevision === meta.documentRevision) {
              setPage(Math.max(1, Math.min(pdf.numPages, readerState.page)));
              setBookmarks(readerState.bookmarks);
              setBookmarkLabel(
                readerState.bookmarks.find(
                  (b) =>
                    b.page ===
                    Math.max(1, Math.min(pdf.numPages, readerState.page)),
                )?.label ?? "",
              );
              setStateReady(true);
              setPageSaveStatus("saved");
            }
            setDoc(pdf);
          } else pdf.destroy();
        }
      } catch (e) {
        if (alive) onError(errorMessage(e));
      } finally {
        if (alive) setInitialLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    setRenderError("");
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled || !canvas.current) return;
        const view = pdfPage.getViewport({ scale: zoom * 1.35 });
        const c = canvas.current;
        c.width = view.width;
        c.height = view.height;
        const context = c.getContext("2d");
        if (!context) return;
        task = pdfPage.render({ canvasContext: context, viewport: view });
        await task.promise;
      } catch (e) {
        if (!cancelled) setRenderError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoom, retry]);
  async function importFile(file: File | undefined) {
    if (!file || initialLoading) return;
    if (file.size > 100 * 1024 * 1024) {
      onError("Choose a PDF smaller than 100 MB.");
      return;
    }
    setBusy(true);
    ++writeVersion.current;
    let importedPdf: pdfjs.PDFDocumentProxy | undefined;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      importedPdf = pdf;
      const meta = native
        ? await invoke<DocumentInfo>("import_book_pdf", {
            bookId,
            fileName: file.name,
            bytes: Array.from(bytes),
          })
        : {
            bookId,
            fileName: file.name,
            importedAt: "",
            documentRevision: crypto.randomUUID(),
          };
      if (!alive.current) {
        pdf.destroy();
        return;
      }
      setInfo(meta);
      setStateReady(!native);
      setBookmarks([]);
      setPage(1);
      setBookmarkLabel("");
      if (native) {
        try {
          const restored = await invoke<ReaderState>("get_book_reader_state", {
            bookId,
          });
          if (restored.documentRevision !== meta.documentRevision)
            throw new Error(
              "The PDF changed while importing. Reopen this book.",
            );
          if (!alive.current) {
            pdf.destroy();
            return;
          }
          setPage(Math.max(1, Math.min(pdf.numPages, restored.page)));
          setBookmarks(restored.bookmarks);
          setBookmarkLabel(
            restored.bookmarks.find(
              (b) =>
                b.page === Math.max(1, Math.min(pdf.numPages, restored.page)),
            )?.label ?? "",
          );
          setStateReady(true);
          setPageSaveStatus("saved");
        } catch (e) {
          if (alive.current) {
            setPageSaveStatus("unavailable");
            onError(
              `PDF imported, but reading state could not be loaded: ${errorMessage(e)}`,
            );
          }
        }
      } else setPageSaveStatus("session");
      if (!alive.current) {
        pdf.destroy();
        return;
      }
      setDoc(pdf);
      importedPdf = undefined;
      setRenderError("");
    } catch (e) {
      importedPdf?.destroy();
      onError(`Could not open PDF: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function goToPage(nextPage: number) {
    if (!doc || busy) return;
    const bounded = Math.max(
      1,
      Math.min(doc.numPages, Math.trunc(nextPage) || 1),
    );
    setPage(bounded);
    setBookmarkLabel(bookmarks.find((b) => b.page === bounded)?.label ?? "");
    if (!native) {
      setPageSaveStatus("session");
      return;
    }
    if (!stateReady || !info?.documentRevision) return;
    const documentRevision = info.documentRevision;
    const version = ++writeVersion.current;
    setPageSaveStatus("saving");
    writeQueue.current = writeQueue.current
      .catch(() => {})
      .then(async () => {
        try {
          await invoke("set_book_page", {
            bookId,
            page: bounded,
            documentRevision,
          });
          if (alive.current && writeVersion.current === version)
            setPageSaveStatus("saved");
        } catch (e) {
          if (alive.current && writeVersion.current === version) {
            setPageSaveStatus("failed");
            onError(`Page position was not saved: ${errorMessage(e)}`);
          }
        }
      });
  }
  async function saveBookmark() {
    if (!doc || !info || !stateReady) return;
    setBookmarkBusy(true);
    try {
      if (native) {
        const state = await invoke<ReaderState>("add_bookmark", {
          bookId,
          page,
          label: bookmarkLabel.trim(),
          documentRevision: info.documentRevision,
        });
        if (alive.current) setBookmarks(state.bookmarks);
      } else {
        setBookmarks((previous) =>
          [
            ...previous.filter((b) => b.page !== page),
            {
              id: crypto.randomUUID(),
              page,
              label: bookmarkLabel.trim() || `Page ${page}`,
              createdAt: new Date().toISOString(),
            },
          ].sort((a, b) => a.page - b.page),
        );
      }
    } catch (e) {
      if (alive.current) onError(`Bookmark was not saved: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setBookmarkBusy(false);
    }
  }
  async function removeBookmark(bookmarkId: string) {
    if (!info || !stateReady) return;
    setBookmarkBusy(true);
    try {
      if (native) {
        const state = await invoke<ReaderState>("remove_bookmark", {
          bookId,
          bookmarkId,
          documentRevision: info.documentRevision,
        });
        if (alive.current) setBookmarks(state.bookmarks);
      } else
        setBookmarks((previous) => previous.filter((b) => b.id !== bookmarkId));
    } catch (e) {
      if (alive.current)
        onError(`Bookmark was not removed: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setBookmarkBusy(false);
    }
  }
  return (
    <div className="pdf-reader">
      <ChapterIndex
        key={bookId}
        bookId={bookId}
        documentRevision={info?.documentRevision ?? null}
        pageCount={doc?.numPages}
        currentPage={doc ? page : undefined}
        onJump={goToPage}
        onActivity={onActivity}
        chapterDraft={chapterDraft}
        onChapterDraftChange={onChapterDraftChange}
      />
      <div className="reader-toolbar">
        <span>
          <FileText size={15} />
          {info?.fileName ?? "Local PDF reader"}
        </span>
        <div className="reader-toolbar-actions">
          {doc && (
            <button
              className={`icon-label ${bookmarksOpen ? "selected" : ""}`}
              aria-expanded={bookmarksOpen}
              onClick={() => setBookmarksOpen(!bookmarksOpen)}
            >
              <Bookmark size={15} />
              Bookmarks <span>{bookmarks.length}</span>
            </button>
          )}
          <button
            className="icon-label"
            onClick={() => fileInput.current?.click()}
            disabled={busy || bookmarkBusy || initialLoading}
          >
            <FileUp size={15} />
            {busy ? "Importing…" : doc ? "Replace PDF" : "Import PDF"}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy || bookmarkBusy || initialLoading}
          hidden
          onChange={(e) => importFile(e.target.files?.[0])}
        />
      </div>
      {doc ? (
        <>
          {bookmarksOpen && (
            <section className="bookmarks-panel" aria-label="PDF bookmarks">
              <div className="bookmarks-heading">
                <div>
                  <h3>Page bookmarks</h3>
                  <p>
                    {native
                      ? "Saved on this device, linked to this exact PDF."
                      : "Temporary browser bookmarks. Close this page and they are gone."}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close bookmarks"
                  onClick={() => setBookmarksOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <form
                className="bookmark-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveBookmark();
                }}
              >
                <span>PAGE {page}</span>
                <input
                  aria-label="Bookmark label"
                  maxLength={120}
                  value={bookmarkLabel}
                  placeholder={
                    bookmarks.some((b) => b.page === page)
                      ? "Update this page’s bookmark label…"
                      : "Give this page a label (optional)…"
                  }
                  onChange={(e) => setBookmarkLabel(e.target.value)}
                />
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={!stateReady || bookmarkBusy || busy}
                >
                  <Bookmark size={13} />
                  {bookmarks.some((b) => b.page === page) ? "Update" : "Save"}
                </button>
              </form>
              {bookmarks.length ? (
                <div className="bookmark-list">
                  {bookmarks.map((b) => (
                    <div
                      key={b.id}
                      className={b.page === page ? "current-bookmark" : ""}
                    >
                      <button
                        className="bookmark-jump"
                        disabled={b.page > doc.numPages || busy}
                        onClick={() => goToPage(b.page)}
                      >
                        <span>{String(b.page).padStart(2, "0")}</span>
                        <strong>{b.label || `Page ${b.page}`}</strong>
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove bookmark ${b.label || `Page ${b.page}`}`}
                        disabled={!stateReady || bookmarkBusy || busy}
                        onClick={() => removeBookmark(b.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="bookmarks-empty">
                  Save a definition, experiment, or idea to come back to.
                </p>
              )}
              {!stateReady && (
                <p className="bookmark-unavailable">
                  Saved reading state is unavailable. Reopen this book before
                  adding bookmarks.
                </p>
              )}
              <small>
                A different PDF has its own reading position and bookmarks.
                Importing the same PDF preserves them.
              </small>
            </section>
          )}
          <div className="pdf-stage">
            {renderError && (
              <div className="empty-state">
                <p>{renderError}</p>
                <button
                  className="secondary-button"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  Retry rendering
                </button>
              </div>
            )}
            <canvas
              ref={canvas}
              style={{ display: renderError ? "none" : "block" }}
              aria-label={`Page ${page} of ${title}`}
            />
          </div>
          <div className="reader-footer">
            <div>
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={page <= 1 || busy}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <label>
                Page{" "}
                <input
                  aria-label="Page number"
                  type="number"
                  min="1"
                  max={doc.numPages}
                  value={page}
                  disabled={busy}
                  onChange={(e) =>
                    goToPage(
                      Math.max(
                        1,
                        Math.min(doc.numPages, Number(e.target.value) || 1),
                      ),
                    )
                  }
                />{" "}
                of {doc.numPages}
              </label>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={page >= doc.numPages || busy}
                onClick={() => goToPage(page + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <span
              className={`page-save-status ${pageSaveStatus}`}
              role="status"
            >
              {pageSaveStatus === "saved" ? (
                <>
                  <Check size={11} />
                  Page saved locally
                </>
              ) : pageSaveStatus === "saving" ? (
                "Saving page…"
              ) : pageSaveStatus === "failed" ? (
                <button onClick={() => goToPage(page)}>
                  Page not saved · Retry
                </button>
              ) : pageSaveStatus === "session" ? (
                "Session only"
              ) : (
                "Page saving unavailable"
              )}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
              >
                <Minus size={15} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="icon-button"
                aria-label="Zoom in"
                disabled={zoom >= 2}
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state document-empty">
          <div className="empty-icon">
            <BookOpen size={32} />
          </div>
          <span className="eyebrow">YOUR BOOK, YOUR MACHINE</span>
          <h2>A place for focused reading.</h2>
          <p>
            Import your own copy of <strong>{title}</strong>. Read it here, keep
            notes alongside it, and test what you understand.
          </p>
          <button
            className="primary-button"
            onClick={() => fileInput.current?.click()}
            disabled={busy || initialLoading}
          >
            <FileUp size={17} />
            {initialLoading
              ? "Opening saved PDF…"
              : busy
                ? "Importing…"
                : "Choose a local PDF"}
          </button>
          <small>
            {native
              ? "Your PDF is copied to private app storage. Nothing is uploaded."
              : "Browser preview: PDF stays in memory and is lost when this page closes."}
          </small>
        </div>
      )}
    </div>
  );
}
