import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import * as pdfjs from "pdfjs-dist";
import { errorMessage } from "./backend";

export type PdfTextSelection = {
  page: number;
  quote: string;
  rects: { x: number; y: number; width: number; height: number }[];
};

function PdfPage({
  doc,
  page,
  zoom,
  estimatedSize,
  visible,
  onSize,
  overlay,
}: {
  doc: pdfjs.PDFDocumentProxy;
  page: number;
  zoom: number;
  estimatedSize: { width: number; height: number };
  visible: boolean;
  onSize: (page: number, size: { width: number; height: number }) => void;
  overlay?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    let layer: pdfjs.TextLayer | undefined;
    setError("");
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled || !canvas.current || !text.current) return;
        const viewport = pdfPage.getViewport({ scale: zoom * 1.35 });
        onSize(page, {
          width: viewport.width / zoom,
          height: viewport.height / zoom,
        });
        const c = canvas.current;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.floor(viewport.width * ratio);
        c.height = Math.floor(viewport.height * ratio);
        c.style.width = `${viewport.width}px`;
        c.style.height = `${viewport.height}px`;
        const context = c.getContext("2d");
        if (!context) throw new Error("The PDF canvas is unavailable.");
        task = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await task.promise;
        if (cancelled) return;
        text.current.replaceChildren();
        // Text extraction is optional for scanned PDFs; their canvas remains readable.
        if (pdfPage.getTextContent) {
          const content = await pdfPage.getTextContent();
          if (cancelled) return;
          layer = new pdfjs.TextLayer({
            textContentSource: content,
            container: text.current,
            viewport,
          });
          await layer.render();
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [doc, page, zoom, visible, retry, onSize]);
  return (
    <div
      className="pdf-page-surface"
      style={{
        width: estimatedSize.width * zoom,
        height: estimatedSize.height * zoom,
      }}
    >
      {visible && (
        <>
          <canvas ref={canvas} aria-label={`PDF page ${page}`} />
          <div
            ref={text}
            className="pdf-text-layer"
            style={{ "--scale-factor": zoom * 1.35 } as CSSProperties}
          />
          {overlay}
          {error && (
            <div className="pdf-page-error" role="alert">
              <p>
                Page {page}: {error}
              </p>
              <button
                className="secondary-button"
                onClick={() => setRetry((v) => v + 1)}
              >
                Retry page {page}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PdfReadingView({
  doc,
  initialPage,
  jump,
  zoom,
  onPageChange,
  onTextSelection,
  onSelectionError,
  renderPageOverlay,
}: {
  doc: pdfjs.PDFDocumentProxy;
  initialPage: number;
  jump: { page: number; version: number } | null;
  zoom: number;
  onPageChange: (page: number) => void;
  onTextSelection?: (selection: PdfTextSelection) => void;
  onSelectionError?: (message: string) => void;
  renderPageOverlay?: (page: number) => ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<
    Record<number, { width: number; height: number }>
  >({});
  const knownSizes = useRef<Record<number, { width: number; height: number }>>(
    {},
  );
  const [visible, setVisible] = useState<Set<number>>(
    () => new Set([initialPage]),
  );
  const currentPage = useRef(initialPage);
  const callbacks = useRef({ onPageChange, onTextSelection, onSelectionError });
  callbacks.current = { onPageChange, onTextSelection, onSelectionError };
  const [baseSize, setBaseSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const initial = useRef(initialPage);
  const lastJump = useRef<typeof jump>(null);
  const sizeAnchor = useRef<{ page: number; offset: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    doc
      .getPage(1)
      .then((p) => {
        if (!cancelled) {
          const v = p.getViewport({ scale: 1.35 });
          setBaseSize({ width: v.width, height: v.height });
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [doc, retry]);
  const onSize = useRef(
    (page: number, size: { width: number; height: number }) => {
      const previous = knownSizes.current;
      if (
        previous[page]?.width === size.width &&
        previous[page]?.height === size.height
      )
        return;
      const root = stage.current;
      if (root && page < currentPage.current && !sizeAnchor.current) {
        const anchor = root.querySelector<HTMLElement>(
          `[data-pdf-page="${currentPage.current}"]`,
        );
        if (anchor)
          sizeAnchor.current = {
            page: currentPage.current,
            offset: root.scrollTop - anchor.offsetTop,
          };
      }
      knownSizes.current = { ...previous, [page]: size };
      setSizes(knownSizes.current);
    },
  ).current;
  useLayoutEffect(() => {
    const anchor = sizeAnchor.current;
    const root = stage.current;
    if (anchor && root) {
      const target = root.querySelector<HTMLElement>(
        `[data-pdf-page="${anchor.page}"]`,
      );
      if (target) root.scrollTop = target.offsetTop + anchor.offset;
    }
    sizeAnchor.current = null;
  }, [sizes]);
  useEffect(() => {
    const root = stage.current;
    if (!root || !baseSize) return;
    sizeAnchor.current = null;
    const page =
      jump !== lastJump.current
        ? (jump?.page ?? initial.current)
        : currentPage.current;
    lastJump.current = jump;
    const target = root.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (target) root.scrollTop = target.offsetTop;
    currentPage.current = page;
    setVisible((previous) => new Set([...previous, page]));
  }, [baseSize, jump, zoom]);
  useEffect(() => {
    const root = stage.current;
    if (!root || !baseSize) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const number = Number(
              (entry.target as HTMLElement).dataset.pdfPage,
            );
            if (entry.isIntersecting) next.add(number);
            else next.delete(number);
          }
          return next;
        });
      },
      { root, rootMargin: "900px 0px" },
    );
    root
      .querySelectorAll("[data-pdf-page]")
      .forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, [doc, baseSize]);
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    function handleScroll() {
      if (!root || root.clientHeight === 0) return;
      const marker =
        root.getBoundingClientRect().top +
        Math.min(root.clientHeight * 0.25, 150);
      const pages = root.querySelectorAll<HTMLElement>("[data-pdf-page]");
      let next = currentPage.current;
      // Page boxes are ordered vertically. Binary search keeps large books cheap.
      let low = 0;
      let high = pages.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const element = pages[middle];
        const rect = element.getBoundingClientRect();
        if (rect.top <= marker && rect.bottom > marker) {
          next = Number(element.dataset.pdfPage);
          break;
        }
        if (rect.top > marker) high = middle - 1;
        else low = middle + 1;
      }
      if (next !== currentPage.current) {
        currentPage.current = next;
        callbacks.current.onPageChange(next);
      }
    }
    root.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", handleScroll);
    };
  }, []);
  function selectText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const start =
      range.startContainer.parentElement?.closest<HTMLElement>(
        "[data-pdf-page]",
      );
    const end =
      range.endContainer.parentElement?.closest<HTMLElement>("[data-pdf-page]");
    if (!start || !stage.current?.contains(start)) return;
    if (start !== end) {
      callbacks.current.onSelectionError?.(
        "Select text on a single PDF page to highlight it.",
      );
      return;
    }
    const surface = start.querySelector<HTMLElement>(".pdf-page-surface")!;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => {
        const x = Math.max(
          0,
          Math.min(1, (r.left - bounds.left) / bounds.width),
        );
        const y = Math.max(
          0,
          Math.min(1, (r.top - bounds.top) / bounds.height),
        );
        return {
          x,
          y,
          width: Math.max(0, Math.min(1 - x, r.width / bounds.width)),
          height: Math.max(0, Math.min(1 - y, r.height / bounds.height)),
        };
      })
      .filter((r) => r.width > 0 && r.height > 0);
    const quote = selection.toString().trim();
    if (rects.length > 200 || new TextEncoder().encode(quote).length > 10_000) {
      callbacks.current.onSelectionError?.(
        "Select a shorter passage to highlight (up to 200 text lines and 10 KB).",
      );
      return;
    }
    if (quote && rects.length)
      callbacks.current.onTextSelection?.({
        page: Number(start.dataset.pdfPage),
        quote,
        rects,
      });
  }
  return (
    <div
      className="pdf-stage continuous-pdf-stage"
      ref={stage}
      tabIndex={0}
      role="region"
      aria-label="PDF pages — scroll to read"
      onMouseUp={selectText}
      onKeyUp={selectText}
    >
      {loadError ? (
        <div className="empty-state">
          <p>{loadError}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry opening pages
          </button>
        </div>
      ) : !baseSize ? (
        <p role="status">Preparing pages…</p>
      ) : (
        Array.from({ length: doc.numPages }, (_, index) => index + 1).map(
          (page) => (
            <section
              key={page}
              className="pdf-continuous-page"
              data-pdf-page={page}
              aria-label={`Page ${page} of ${doc.numPages}`}
            >
              <span className="pdf-page-caption">Page {page}</span>
              <PdfPage
                doc={doc}
                page={page}
                zoom={zoom}
                estimatedSize={sizes[page] ?? baseSize}
                visible={visible.has(page)}
                onSize={onSize}
                overlay={renderPageOverlay?.(page)}
              />
            </section>
          ),
        )
      )}
    </div>
  );
}
