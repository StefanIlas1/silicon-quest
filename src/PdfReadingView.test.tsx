import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfReadingView from "./PdfReadingView";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  cancel: vi.fn(),
  textRender: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  TextLayer: class {
    container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
    }
    render() {
      this.container.innerHTML = "<span>Locality matters</span>";
      mocks.textRender();
      return Promise.resolve();
    }
    cancel() {}
  },
}));
let observe: IntersectionObserverCallback;
let doc: PDFDocumentProxy;
const rect = (top: number, height: number, width = 100, left = 0) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  width,
  height,
  x: left,
  y: top,
  toJSON() {},
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      return Number(this.dataset.pdfPage || 0) * 300;
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  mocks.render.mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: mocks.cancel,
  }));
  doc = {
    numPages: 20,
    getPage: vi.fn().mockImplementation(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 100 * scale,
        height: 200 * scale,
      }),
      render: mocks.render,
      getTextContent: async () => ({ items: [] }),
    })),
  } as unknown as PDFDocumentProxy;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("continuous PDF pages", () => {
  it("lays out the whole book, restores the page, and renders only nearby canvases with selectable text", async () => {
    render(
      <PdfReadingView
        doc={doc}
        initialPage={3}
        jump={null}
        zoom={1}
        onPageChange={vi.fn()}
      />,
    );
    await screen.findByRole("region", { name: "Page 20 of 20" });
    await waitFor(() => expect(mocks.textRender).toHaveBeenCalledOnce());
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(screen.getByRole("region", { name: /PDF pages/ }).scrollTop).toBe(
      900,
    );
    const page = document.querySelector('[data-pdf-page="4"]')!;
    act(() =>
      observe(
        [
          { target: page, isIntersecting: true },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    await screen.findByLabelText("PDF page 4");
    expect(document.querySelectorAll(".pdf-text-layer span")).toHaveLength(2);
    act(() =>
      observe(
        [
          { target: page, isIntersecting: false },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.queryByLabelText("PDF page 4")).toBeNull();
    expect(document.querySelectorAll("[data-pdf-page]")).toHaveLength(20);
  });
  it("reports the visible page after scrolling and retains that page when zoom changes", async () => {
    const changed = vi.fn();
    const { rerender } = render(
      <PdfReadingView
        doc={doc}
        initialPage={3}
        jump={null}
        zoom={1}
        onPageChange={changed}
      />,
    );
    await screen.findByRole("region", { name: "Page 20 of 20" });
    const stage = screen.getByRole("region", { name: /PDF pages/ });
    Object.defineProperty(stage, "clientHeight", { value: 500 });
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(rect(0, 500));
    document
      .querySelectorAll<HTMLElement>("[data-pdf-page]")
      .forEach((p) =>
        vi
          .spyOn(p, "getBoundingClientRect")
          .mockReturnValue(rect((Number(p.dataset.pdfPage) - 5) * 300, 300)),
      );
    fireEvent.scroll(stage);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(5));
    rerender(
      <PdfReadingView
        doc={doc}
        initialPage={5}
        jump={null}
        zoom={1.2}
        onPageChange={changed}
      />,
    );
    expect(stage.scrollTop).toBe(1500);
    rerender(
      <PdfReadingView
        doc={doc}
        initialPage={5}
        jump={{ page: 12, version: 1 }}
        zoom={1.2}
        onPageChange={changed}
      />,
    );
    expect(stage.scrollTop).toBe(3600);
    await screen.findByLabelText("PDF page 12");
  });
  it("returns the selected quote and page-relative rectangles for persistent highlights", async () => {
    const selected = vi.fn();
    const selectionError = vi.fn();
    render(
      <PdfReadingView
        doc={doc}
        initialPage={1}
        jump={null}
        zoom={1}
        onPageChange={vi.fn()}
        onTextSelection={selected}
        onSelectionError={selectionError}
      />,
    );
    await waitFor(() => expect(mocks.textRender).toHaveBeenCalled());
    const text = document.querySelector(".pdf-text-layer span")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    Object.defineProperty(range, "getClientRects", {
      configurable: true,
      value: () => [rect(40, 10, 30, 20)],
    });
    vi.spyOn(
      document.querySelector<HTMLElement>(".pdf-page-surface")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(20, 200, 100, 10));
    fireEvent.mouseUp(screen.getByRole("region", { name: /PDF pages/ }));
    expect(selected).toHaveBeenCalledWith({
      page: 1,
      quote: "Locality matters",
      rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.05 }],
    });
    // Resizing, fullscreen, and zoom may move and scale the page, while the
    // persisted coordinates must continue to describe the same passage.
    for (const scale of [0.6, 1.5, 2]) {
      vi.mocked(
        document.querySelector<HTMLElement>(".pdf-page-surface")!
          .getBoundingClientRect,
      ).mockReturnValue(rect(70, 200 * scale, 100 * scale, 50));
      Object.defineProperty(range, "getClientRects", {
        configurable: true,
        value: () => [
          rect(70 + 20 * scale, 10 * scale, 30 * scale, 50 + 10 * scale),
        ],
      });
      fireEvent.mouseUp(screen.getByRole("region", { name: /PDF pages/ }));
      expect(selected).toHaveBeenLastCalledWith({
        page: 1,
        quote: "Locality matters",
        rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.05 }],
      });
    }
    vi.mocked(
      document.querySelector<HTMLElement>(".pdf-page-surface")!
        .getBoundingClientRect,
    ).mockReturnValue(rect(20, 200, 100, 10));
    Object.defineProperty(range, "getClientRects", {
      configurable: true,
      value: () => [rect(10, 30, 40, 0), rect(240, 10, 10, 120)],
    });
    fireEvent.mouseUp(screen.getByRole("region", { name: /PDF pages/ }));
    expect(selected).toHaveBeenLastCalledWith({
      page: 1,
      quote: "Locality matters",
      rects: [{ x: 0, y: 0, width: 0.3, height: 0.1 }],
    });
    selected.mockClear();
    Object.defineProperty(range, "getClientRects", {
      configurable: true,
      value: () => Array.from({ length: 201 }, () => rect(40, 10, 30, 20)),
    });
    fireEvent.mouseUp(screen.getByRole("region", { name: /PDF pages/ }));
    expect(selected).not.toHaveBeenCalled();
    expect(selectionError).toHaveBeenCalledWith(
      expect.stringContaining("shorter passage"),
    );
    // A page caption or error message is not PDF text.
    range.selectNodeContents(document.querySelector(".pdf-page-caption")!);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(screen.getByRole("region", { name: /PDF pages/ }));
    expect(selected).not.toHaveBeenCalled();
    selection.removeAllRanges();
  });
  it("removes text from the old zoom while its replacement render is pending", async () => {
    const props = {
      doc,
      initialPage: 1,
      jump: null,
      onPageChange: vi.fn(),
    };
    const view = render(<PdfReadingView {...props} zoom={1} />);
    await waitFor(() => expect(mocks.textRender).toHaveBeenCalledOnce());
    let finish!: () => void;
    mocks.render.mockImplementationOnce(() => ({
      promise: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      cancel: mocks.cancel,
    }));
    view.rerender(<PdfReadingView {...props} zoom={1.5} />);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    expect(document.querySelector(".pdf-text-layer")?.textContent).toBe("");
    await act(async () => finish());
    expect(document.querySelector(".pdf-text-layer")?.textContent).toBe(
      "Locality matters",
    );
  });
  it("does not retain an old scroll anchor when a cached page rerenders at a new zoom", async () => {
    const changed = vi.fn();
    const { rerender } = render(
      <PdfReadingView
        doc={doc}
        initialPage={3}
        jump={null}
        zoom={1}
        onPageChange={changed}
      />,
    );
    await screen.findByRole("region", { name: "Page 20 of 20" });
    const page2 = document.querySelector('[data-pdf-page="2"]')!;
    act(() =>
      observe(
        [
          { target: page2, isIntersecting: true },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    await waitFor(() => expect(mocks.textRender).toHaveBeenCalledTimes(2));
    rerender(
      <PdfReadingView
        doc={doc}
        initialPage={3}
        jump={null}
        zoom={1.2}
        onPageChange={changed}
      />,
    );
    await waitFor(() => expect(mocks.textRender).toHaveBeenCalledTimes(4));
    const stage = screen.getByRole("region", { name: /PDF pages/ });
    Object.defineProperty(stage, "clientHeight", { value: 500 });
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(rect(0, 500));
    document
      .querySelectorAll<HTMLElement>("[data-pdf-page]")
      .forEach((p) =>
        vi
          .spyOn(p, "getBoundingClientRect")
          .mockReturnValue(rect((Number(p.dataset.pdfPage) - 5) * 300, 300)),
      );
    stage.scrollTop = 3333;
    fireEvent.scroll(stage);
    expect(changed).toHaveBeenCalledWith(5);
    const page4 = document.querySelector('[data-pdf-page="4"]')!;
    act(() =>
      observe(
        [
          { target: page4, isIntersecting: true },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    await waitFor(() => expect(mocks.textRender).toHaveBeenCalledTimes(5));
    expect(stage.scrollTop).toBe(3333);
  });
  it("allows retrying an individual failed page without reopening the book", async () => {
    mocks.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("Canvas failed")),
      cancel: mocks.cancel,
    }));
    render(
      <PdfReadingView
        doc={doc}
        initialPage={1}
        jump={null}
        zoom={1}
        onPageChange={vi.fn()}
      />,
    );
    await screen.findByText("Page 1: Canvas failed");
    fireEvent.click(screen.getByRole("button", { name: "Retry page 1" }));
    await waitFor(() =>
      expect(screen.queryByText("Page 1: Canvas failed")).toBeNull(),
    );
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });
});
