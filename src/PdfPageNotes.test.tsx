import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import PdfPageNotes from "./PdfPageNotes";
import { PdfAnnotationOverlay, type PdfAnnotation } from "./PdfAnnotations";

const note: PdfAnnotation = {
  id: "highlight-note",
  page: 3,
  body: "Cache lines explain the difference.\nMeasure this next.",
  quote: "Locality matters",
  rects: [{ x: 0.1, y: 0.25, width: 0.3, height: 0.04 }],
  version: 2,
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PDF page notes", () => {
  it("shows accessible highlight and page-note markers outside the hidden visual highlights", () => {
    const view = render(
      <PdfAnnotationOverlay
        page={3}
        annotations={[
          note,
          {
            ...note,
            id: "page-note",
            quote: null,
            rects: [],
            body: "Page summary",
          },
          { ...note, id: "other-page", page: 4, body: "Another page" },
          { ...note, id: "highlight-only", body: "" },
        ]}
      />,
    );
    const highlight = screen.getByRole("button", {
      name: /Read note 1 on page 3/,
    });
    const pageNote = screen.getByRole("button", {
      name: /Read note 2 on page 3/,
    });
    expect(highlight.closest('[aria-hidden="true"]')).toBeNull();
    expect(highlight.style.top).toBe("25%");
    expect(pageNote.style.top).toBe("0%");
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      view.container.querySelectorAll(".pdf-annotation-overlay > span"),
    ).toHaveLength(2);
    fireEvent.click(highlight);
    const panel = screen.getByRole("complementary", {
      name: "Note 1 on PDF page 3",
    });
    expect(panel.textContent).toContain(note.body);
    expect(panel.textContent).toContain(note.quote);
    expect(document.activeElement).toBe(panel);
    expect(highlight.getAttribute("aria-expanded")).toBe("true");
    expect(highlight.getAttribute("aria-controls")).toBe(panel.id);
    const escape = createEvent.keyDown(panel, { key: "Escape" });
    fireEvent(panel, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(highlight);
    fireEvent.click(pageNote);
    expect(screen.getByRole("complementary").textContent).toContain(
      "Page summary",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close page note" }));
    expect(document.activeElement).toBe(pageNote);
  });

  it("closes stale notes when deleted, switched to another page, or body becomes empty", () => {
    const view = render(<PdfPageNotes page={3} annotations={[note]} />);
    fireEvent.click(screen.getByRole("button", { name: /Read note/ }));
    view.rerender(
      <PdfPageNotes
        page={3}
        annotations={[{ ...note, body: "Updated note" }]}
      />,
    );
    expect(screen.getByRole("complementary").textContent).toContain(
      "Updated note",
    );
    view.rerender(
      <PdfPageNotes page={3} annotations={[{ ...note, body: "" }]} />,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    view.rerender(<PdfPageNotes page={3} annotations={[note]} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Read note/ }));
    view.rerender(<PdfPageNotes page={4} annotations={[note]} />);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("separates nearby markers, clamps them to the page, and recalculates after resizing", () => {
    let resize!: () => void;
    let height = 600;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      () => height,
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const annotations = [
      note,
      { ...note, id: "same-passage" },
      {
        ...note,
        id: "end",
        rects: [{ x: 0, y: 0.99, width: 0.1, height: 0.01 }],
      },
    ];
    const view = render(<PdfPageNotes page={3} annotations={annotations} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.style.top)).toEqual([
      "150px",
      "180px",
      "572px",
    ]);
    height = 300;
    // A fullscreen or zoom change resizes the same rail, preserving the note's
    // normalized passage anchor while keeping controls large enough to use.
    act(() => resize());
    expect(buttons.map((button) => button.style.top)).toEqual([
      "75px",
      "105px",
      "272px",
    ]);
    height = 50;
    act(() => resize());
    expect(
      view.container.querySelector(".pdf-page-note-markers.is-crowded"),
    ).not.toBeNull();
    expect(buttons.map((button) => button.style.top)).toEqual([
      "0px",
      "30px",
      "60px",
    ]);
  });
});
