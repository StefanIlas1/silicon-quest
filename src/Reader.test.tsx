import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Reader from "./Reader";
const mock = vi.hoisted(() => ({
  native: true,
  invoke: vi.fn(),
  getPage: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  isTauri: () => true,
}));
vi.mock("./backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend")>()),
  get native() {
    return mock.native;
  },
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 7,
      getPage: mock.getPage,
      destroy: mock.destroy,
    }),
  }),
}));
const meta = {
  bookId: "csapp",
  fileName: "My own book.pdf",
  importedAt: "2026-11-10",
  documentRevision: "revision-a",
};
const initial = {
  page: 3,
  documentRevision: "revision-a",
  bookmarks: [
    { id: "b1", page: 6, label: "Cache experiment", createdAt: "2026-11-10" },
  ],
};
let state = structuredClone(initial);
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  state = structuredClone(initial);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  mock.getPage.mockResolvedValue({
    getViewport: () => ({ width: 100, height: 200 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  });
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "get_book_document") return meta;
    if (command === "get_book_pdf") return [37, 80, 68, 70];
    if (command === "get_book_reader_state") return state;
    if (command === "import_book_pdf") return meta;
    if (command === "set_book_page") {
      state = { ...state, page: args.page };
      return;
    }
    if (command === "add_bookmark") {
      state = {
        ...state,
        bookmarks: [
          ...state.bookmarks.filter((b) => b.page !== args.page),
          {
            id: "b2",
            page: args.page,
            label: args.label,
            createdAt: "2026-11-10",
          },
        ],
      };
      return state;
    }
    if (command === "remove_bookmark") {
      state = {
        ...state,
        bookmarks: state.bookmarks.filter((b) => b.id !== args.bookmarkId),
      };
      return state;
    }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("persisted PDF workspace", () => {
  it("keeps browser bookmarks and page movement temporary without invoking storage", async () => {
    mock.native = false;
    render(<Reader bookId="csapp" title="Systems" onError={vi.fn()} />);
    const file = new File(["%PDF-1.7"], "My copy.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([37, 80, 68, 70]).buffer,
    });
    fireEvent.change(document.querySelector("input[type=file]")!, {
      target: { files: [file] },
    });
    await screen.findByRole("spinbutton", { name: "Page number" });
    fireEvent.click(screen.getByRole("button", { name: /Bookmarks/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Bookmark label" }), {
      target: { value: "Temporary idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Temporary idea");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Session only")).toBeTruthy();
    expect(
      screen.getByText(
        "Temporary browser bookmarks. Close this page and they are gone.",
      ),
    ).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("preserves same-PDF state but loads fresh state when importing a different revision", async () => {
    render(<Reader bookId="csapp" title="Systems" onError={vi.fn()} />);
    await screen.findByRole("spinbutton", { name: "Page number" });
    const file = new File(["%PDF-1.7"], "My copy.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([37, 80, 68, 70]).buffer,
    });
    fireEvent.change(document.querySelector("input[type=file]")!, {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Replace PDF",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Page number",
        }) as HTMLInputElement
      ).value,
    ).toBe("3");
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation((command, args) => {
      if (command === "import_book_pdf") {
        state = { page: 1, documentRevision: "revision-b", bookmarks: [] };
        return Promise.resolve({ ...meta, documentRevision: "revision-b" });
      }
      return implementation(command, args);
    });
    fireEvent.change(document.querySelector("input[type=file]")!, {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Replace PDF",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Page number",
        }) as HTMLInputElement
      ).value,
    ).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /Bookmarks/ }));
    expect(screen.queryByText("Cache experiment")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("set_book_page", {
        bookId: "csapp",
        page: 2,
        documentRevision: "revision-b",
      }),
    );
  });
  it("restores the saved page after parsing and never overwrites it with initial page one", async () => {
    render(<Reader bookId="csapp" title="Systems" onError={vi.fn()} />);
    expect(
      (
        (await screen.findByRole("spinbutton", {
          name: "Page number",
        })) as HTMLInputElement
      ).value,
    ).toBe("3");
    expect(mock.invoke).toHaveBeenCalledWith("get_book_pdf", {
      bookId: "csapp",
      documentRevision: "revision-a",
    });
    expect(
      mock.invoke.mock.calls.some(([command]) => command === "set_book_page"),
    ).toBe(false);
    expect(screen.getByText("Page saved locally")).toBeTruthy();
  });
  it("serializes rapid page changes and waits for acknowledgement before saying saved", async () => {
    let release: () => void = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation((command, args) =>
      command === "set_book_page" && args.page === 4
        ? firstWrite
        : implementation(command, args),
    );
    render(<Reader bookId="csapp" title="Systems" onError={vi.fn()} />);
    await screen.findByRole("spinbutton", { name: "Page number" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(
        mock.invoke.mock.calls.filter(([c]) => c === "set_book_page").length,
      ).toBe(1),
    );
    expect(screen.getByText("Saving page…")).toBeTruthy();
    release();
    await screen.findByText("Page saved locally");
    expect(
      mock.invoke.mock.calls
        .filter(([c]) => c === "set_book_page")
        .map(([, a]) => a.page),
    ).toEqual([4, 5]);
    expect(state.page).toBe(5);
  });
  it("adds, jumps to and removes a revision-bound bookmark", async () => {
    render(<Reader bookId="csapp" title="Systems" onError={vi.fn()} />);
    await screen.findByRole("spinbutton", { name: "Page number" });
    fireEvent.click(screen.getByRole("button", { name: /Bookmarks/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Bookmark label" }), {
      target: { value: "My working-set hypothesis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("My working-set hypothesis");
    expect(mock.invoke).toHaveBeenCalledWith("add_bookmark", {
      bookId: "csapp",
      page: 3,
      label: "My working-set hypothesis",
      documentRevision: "revision-a",
    });
    fireEvent.click(
      screen.getByRole("button", { name: /06 Cache experiment/ }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("spinbutton", {
            name: "Page number",
          }) as HTMLInputElement
        ).value,
      ).toBe("6"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove bookmark Cache experiment" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Cache experiment")).toBeNull(),
    );
    expect(mock.invoke).toHaveBeenCalledWith("remove_bookmark", {
      bookId: "csapp",
      bookmarkId: "b1",
      documentRevision: "revision-a",
    });
  });
  it("reports a failed page save and offers a real retry", async () => {
    const onError = vi.fn();
    let fail = true;
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation((command, args) =>
      command === "set_book_page" && fail
        ? Promise.reject({ message: "Disk write failed" })
        : implementation(command, args),
    );
    render(<Reader bookId="csapp" title="Systems" onError={onError} />);
    await screen.findByRole("spinbutton", { name: "Page number" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("button", { name: "Page not saved · Retry" });
    expect(onError).toHaveBeenCalledWith(
      "Page position was not saved: Disk write failed",
    );
    fail = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Page not saved · Retry" }),
    );
    await screen.findByText("Page saved locally");
    expect(state.page).toBe(4);
  });
  it("keeps PDF reading available but disables bookmark writes if saved state cannot be loaded", async () => {
    const onError = vi.fn();
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation((command, args) =>
      command === "get_book_reader_state"
        ? Promise.reject({ message: "Database unavailable" })
        : implementation(command, args),
    );
    render(<Reader bookId="csapp" title="Systems" onError={onError} />);
    await screen.findByRole("spinbutton", { name: "Page number" });
    fireEvent.click(screen.getByRole("button", { name: /Bookmarks/ }));
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Page saving unavailable")).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      "Reading state unavailable: Database unavailable",
    );
  });
});
