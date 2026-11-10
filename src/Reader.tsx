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
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { native, errorMessage } from "./backend";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
type DocumentInfo = { bookId: string; fileName: string; importedAt: string };
export default function Reader({
  bookId,
  title,
  onError,
}: {
  bookId: string;
  title: string;
  onError: (message: string) => void;
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [retry, setRetry] = useState(0);
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
    setRenderError("");
    if (!native) return;
    (async () => {
      try {
        const meta = await invoke<DocumentInfo | null>("get_book_document", {
          bookId,
        });
        if (meta) {
          const bytes = await invoke<number[]>("get_book_pdf", { bookId });
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) })
            .promise;
          if (alive) {
            setInfo(meta);
            setDoc(pdf);
          } else pdf.destroy();
        }
      } catch (e) {
        if (alive) onError(errorMessage(e));
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
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      onError("Choose a PDF smaller than 100 MB.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const meta = native
        ? await invoke<DocumentInfo>("import_book_pdf", {
            bookId,
            fileName: file.name,
            bytes: Array.from(bytes),
          })
        : { bookId, fileName: file.name, importedAt: "" };
      if (!alive.current) {
        pdf.destroy();
        return;
      }
      setInfo(meta);
      setDoc(pdf);
      setPage(1);
      setRenderError("");
    } catch (e) {
      onError(`Could not open PDF: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <div className="pdf-reader">
      <div className="reader-toolbar">
        <span>
          <FileText size={15} />
          {info?.fileName ?? "Local PDF reader"}
        </span>
        <button
          className="icon-label"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <FileUp size={15} />
          {busy ? "Importing…" : doc ? "Replace PDF" : "Import PDF"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => importFile(e.target.files?.[0])}
        />
      </div>
      {doc ? (
        <>
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
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
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
                  onChange={(e) =>
                    setPage(
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
                disabled={page >= doc.numPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
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
            disabled={busy}
          >
            <FileUp size={17} />
            {busy ? "Importing…" : "Choose a local PDF"}
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
