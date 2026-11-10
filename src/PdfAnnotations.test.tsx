import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PdfAnnotations, {
  PdfAnnotationOverlay,
  discardAnnotationDrafts,
  hasAnnotationDrafts,
  type PdfAnnotation,
} from "./PdfAnnotations";
const mock = vi.hoisted(() => ({ native: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  isTauri: () => true,
}));
vi.mock("./backend", async (original) => ({
  ...(await original<typeof import("./backend")>()),
  get native() {
    return mock.native;
  },
}));
const saved: PdfAnnotation = {
  id: "saved-note",
  page: 7,
  body: "Private insight",
  quote: null,
  rects: [],
  version: 3,
  createdAt: "2026-11-10T01:00:00Z",
  updatedAt: "2026-11-10T01:00:00Z",
};
const props = {
  bookId: "csapp",
  documentRevision: "revision-one",
  page: 4,
  pageCount: 20,
  onNavigate: vi.fn(),
  onError: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.native = true;
  discardAnnotationDrafts();
  mock.invoke.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  discardAnnotationDrafts();
});
async function open() {
  fireEvent.click(screen.getByRole("button", { name: /Annotations/ }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("get_pdf_annotations", {
      bookId: props.bookId,
      documentRevision: props.documentRevision,
    }),
  );
}
async function add() {
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Note on page 4",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Note on page 4" }));
}
describe("private PDF annotations", () => {
  it("anchors a new page note and clears draft only after the saved acknowledgement", async () => {
    mock.invoke.mockImplementation(async (command, args) =>
      command === "save_pdf_annotation"
        ? [{ ...saved, ...args.input, version: 1 }]
        : [],
    );
    render(<PdfAnnotations {...props} />);
    await add();
    fireEvent.change(screen.getByLabelText("Page note"), {
      target: { value: "My new note" },
    });
    expect(hasAnnotationDrafts()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save page note" }));
    await screen.findByText("Annotation saved locally.");
    expect(hasAnnotationDrafts()).toBe(false);
    expect(mock.invoke).toHaveBeenCalledWith(
      "save_pdf_annotation",
      expect.objectContaining({
        bookId: "csapp",
        documentRevision: "revision-one",
        input: expect.objectContaining({
          page: 4,
          body: "My new note",
          expectedVersion: 0,
          quote: null,
          rects: [],
        }),
      }),
    );
  });
  it("retains failed draft through navigation and isolates a replacement PDF", async () => {
    mock.invoke.mockImplementation(async (command) => {
      if (command === "save_pdf_annotation") throw { message: "PDF changed" };
      return [];
    });
    const first = render(<PdfAnnotations {...props} />);
    await add();
    fireEvent.change(screen.getByLabelText("Page note"), {
      target: { value: "Do not lose this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save page note" }));
    await screen.findByRole("alert");
    first.unmount();
    const replacement = render(
      <PdfAnnotations {...props} documentRevision="replacement" />,
    );
    await open();
    expect(screen.queryByLabelText("Page note")).toBeNull();
    replacement.unmount();
    render(<PdfAnnotations {...props} />);
    expect(
      (screen.getByLabelText("Page note") as HTMLTextAreaElement).value,
    ).toBe("Do not lose this");
  });
  it("loads, jumps, edits with expected version and removes only after explicit click", async () => {
    mock.invoke.mockImplementation(async (command) =>
      command === "remove_pdf_annotation" ? [] : [saved],
    );
    render(<PdfAnnotations {...props} />);
    await open();
    await screen.findByText("Private insight");
    fireEvent.click(screen.getByRole("button", { name: "PDF page 7" }));
    expect(props.onNavigate).toHaveBeenCalledWith(7);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit note on page 7" }),
    );
    fireEvent.change(screen.getByLabelText("Page note"), {
      target: { value: "Changed insight" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save page note" }));
    await screen.findByText("Annotation saved locally.");
    expect(mock.invoke).toHaveBeenCalledWith(
      "save_pdf_annotation",
      expect.objectContaining({
        input: expect.objectContaining({
          id: "saved-note",
          expectedVersion: 3,
          page: 7,
        }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove note on page 7" }),
    );
    expect(
      mock.invoke.mock.calls.some(([c]) => c === "remove_pdf_annotation"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove note" }));
    await screen.findByText("Annotation removed.");
    expect(mock.invoke).toHaveBeenCalledWith(
      "remove_pdf_annotation",
      expect.objectContaining({
        annotationId: "saved-note",
        expectedVersion: 3,
      }),
    );
  });
  it("saves a real selection anchor as a highlight and emits it for the page overlay", async () => {
    const selection = {
      page: 3,
      quote: "Cache locality",
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
    };
    const onAnnotationsChange = vi.fn();
    const onSelectionClear = vi.fn();
    mock.invoke.mockImplementation(async (command, args) =>
      command === "save_pdf_annotation"
        ? [{ ...saved, ...args.input, version: 1 }]
        : [],
    );
    render(
      <PdfAnnotations
        {...props}
        selection={selection}
        onAnnotationsChange={onAnnotationsChange}
        onSelectionClear={onSelectionClear}
      />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Highlight selected text",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Highlight selected text" }),
    );
    expect(onSelectionClear).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Save highlight" }));
    await screen.findByText("Annotation saved locally.");
    expect(mock.invoke).toHaveBeenCalledWith(
      "save_pdf_annotation",
      expect.objectContaining({
        input: expect.objectContaining({
          ...selection,
          body: "",
          expectedVersion: 0,
        }),
      }),
    );
    expect(onAnnotationsChange).toHaveBeenLastCalledWith([
      expect.objectContaining(selection),
    ]);
    const overlay = render(
      <PdfAnnotationOverlay
        page={3}
        annotations={[{ ...saved, ...selection }]}
      />,
    );
    const rectangle = overlay.container.querySelector(
      ".pdf-annotation-overlay span",
    ) as HTMLElement;
    expect(rectangle.style.left).toBe("10%");
    expect(rectangle.style.width).toBe("30%");
  });
  it("explains disabled writes and allows load recovery with annotations collapsed", async () => {
    mock.invoke.mockRejectedValue({ message: "Saved notes unavailable" });
    render(<PdfAnnotations {...props} />);
    await screen.findByRole("alert");
    expect(screen.getByText("Saved notes unavailable")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Annotations/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      (
        screen.getByRole("button", {
          name: "Note on page 4",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    mock.invoke.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Reload saved notes" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Note on page 4",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    mock.native = false;
    render(<PdfAnnotations {...props} />);
    expect(screen.getByText(/Open the desktop app/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Note on page 4",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("explains an existing draft and offers to reopen it beside a disabled highlight", async () => {
    const selection = {
      page: 4,
      quote: "Cache locality",
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
    };
    render(<PdfAnnotations {...props} selection={selection} />);
    await add();
    fireEvent.change(screen.getByLabelText("Page note"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Annotations/ }));
    expect(
      (
        screen.getByRole("button", {
          name: "Highlight selected text",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue draft" }));
    expect(
      (screen.getByLabelText("Page note") as HTMLTextAreaElement).value,
    ).toBe("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Highlight selected text",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("does not show an old response in a different PDF", async () => {
    let resolve!: (notes: PdfAnnotation[]) => void;
    mock.invoke.mockImplementation(
      () =>
        new Promise<PdfAnnotation[]>((r) => {
          resolve = r;
        }),
    );
    const view = render(<PdfAnnotations {...props} />);
    const oldResolve = resolve;
    view.rerender(
      <PdfAnnotations {...props} documentRevision="new-revision" />,
    );
    await act(async () => oldResolve([saved]));
    fireEvent.click(screen.getByRole("button", { name: /Annotations/ }));
    expect(screen.queryByText("Private insight")).toBeNull();
  });
});
