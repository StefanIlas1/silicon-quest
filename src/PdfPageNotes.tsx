import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import type { PdfAnnotation } from "./PdfAnnotations";
import "./PdfPageNotes.css";

// Notes remain outside the page so neither their markers nor their text obscure
// PDF content. Coordinates use the same normalized page space as highlights.
export default function PdfPageNotes({
  annotations,
  page,
}: {
  annotations: PdfAnnotation[];
  page: number;
}) {
  const notes = annotations.filter(
    (annotation) => annotation.page === page && annotation.body.trim(),
  );
  const rail = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const [height, setHeight] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const id = useId();
  const open = notes.find((note) => note.id === openId);
  useEffect(() => {
    if (!open) setOpenId(null);
  }, [open]);
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [notes.length > 0]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [openId]);
  if (!notes.length) return null;

  const anchored = notes
    .map((note, index) => ({
      note,
      number: index + 1,
      y:
        note.rects.find(
          (rect) => Number.isFinite(rect.y) && rect.y >= 0 && rect.y <= 1,
        )?.y ?? 0,
      top: 0,
    }))
    .sort((a, b) => a.y - b.y || a.number - b.number);
  const crowded = height > 0 && notes.length * 30 > height;
  for (let index = 0; index < anchored.length; index++) {
    anchored[index].top = crowded
      ? index * 30
      : Math.max(
          anchored[index].y * height,
          (anchored[index - 1]?.top ?? -30) + 30,
        );
  }
  if (height && !crowded) {
    for (let index = anchored.length - 1; index >= 0; index--)
      anchored[index].top = Math.min(
        anchored[index].top,
        index === anchored.length - 1
          ? Math.max(0, height - 28)
          : anchored[index + 1].top - 30,
      );
  }
  const active = anchored.find(({ note }) => note.id === openId);
  function close() {
    setOpenId(null);
    if (openId) markers.current.get(openId)?.focus({ preventScroll: true });
  }
  return (
    <div
      className={`pdf-page-notes${open ? " is-expanded" : ""}`}
      ref={rail}
      role="group"
      aria-label={`Notes on PDF page ${page}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={`pdf-page-note-markers${crowded ? " is-crowded" : ""}`}>
        {anchored.map(({ note, number, y, top }) => (
          <button
            key={note.id}
            ref={(element) => {
              if (element) markers.current.set(note.id, element);
              else markers.current.delete(note.id);
            }}
            className="pdf-page-note-marker"
            style={{ top: height ? top : `${y * 100}%` }}
            aria-label={`Read note ${number} on page ${page}: ${note.body.slice(0, 80)}`}
            aria-expanded={note.id === openId}
            aria-controls={note.id === openId ? `${id}-note` : undefined}
            title={
              note.quote
                ? `Note on highlighted text: ${note.body}`
                : `Page note: ${note.body}`
            }
            onClick={() => (note.id === openId ? close() : setOpenId(note.id))}
          >
            <MessageSquare size={12} aria-hidden="true" />
            <span>{number}</span>
          </button>
        ))}
      </div>
      {open && (
        <aside
          ref={panel}
          id={`${id}-note`}
          className="pdf-page-note-expanded"
          tabIndex={-1}
          aria-label={`Note ${active?.number} on PDF page ${page}`}
          style={{
            top: `clamp(0px, ${active?.top ?? 0}px, max(0px, calc(100% - 260px)))`,
          }}
        >
          <div className="pdf-page-note-heading">
            <strong>
              {open.quote ? "Highlight note" : "Page note"} {active?.number}
            </strong>
            <button
              className="pdf-page-note-close"
              aria-label="Close page note"
              onClick={close}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {open.quote && <blockquote>{open.quote}</blockquote>}
          <p>{open.body}</p>
        </aside>
      )}
    </div>
  );
}
