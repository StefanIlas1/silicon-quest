import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ChapterDraft } from "./ChapterIndex";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ChapterIndex, { type Chapter } from "./ChapterIndex";
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
const existing: Chapter = {
  id: "stable-chapter",
  bookId: "csapp",
  title: "My actual edition title",
  position: 1,
  status: "read",
  note: "Private chapter note",
  pageStart: 3,
  pageEnd: 7,
  documentRevision: "revision-a",
  version: 2,
  createdAt: "2026-11-10",
  updatedAt: "2026-11-10",
};
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  mock.invoke.mockResolvedValue({ chapters: [], documentRevision: null });
});
afterEach(cleanup);
function add() {
  fireEvent.click(screen.getByRole("button", { name: "Add chapter" }));
}
function type(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
describe("manual chapter indexing", () => {
  it("retains failed-save drafts and original versions when navigating between books", async () => {
    mock.invoke.mockImplementation(async (command) => {
      if (command === "save_book_chapter")
        throw { message: "Chapter version conflict" };
      return { chapters: [existing], documentRevision: "revision-a" };
    });
    function Workspace() {
      const [visible, setVisible] = useState(true);
      const [book, setBook] = useState("csapp");
      const [drafts, setDrafts] = useState<Record<string, ChapterDraft>>({});
      return (
        <>
          <button onClick={() => setVisible((v) => !v)}>Toggle reader</button>
          <button
            onClick={() =>
              setBook((b) => (b === "csapp" ? "optimized-cpp" : "csapp"))
            }
          >
            Switch book
          </button>
          {visible && (
            <ChapterIndex
              key={book}
              bookId={book}
              documentRevision="revision-a"
              onJump={vi.fn()}
              chapterDraft={drafts[book] ?? null}
              onChapterDraftChange={(draft) =>
                setDrafts((previous) => {
                  const next = { ...previous };
                  if (draft) next[book] = draft;
                  else delete next[book];
                  return next;
                })
              }
            />
          )}
        </>
      );
    }
    render(<Workspace />);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Add chapter",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Chapter index/ }));
    fireEvent.click(
      screen.getByRole("button", { name: `Edit chapter ${existing.title}` }),
    );
    type("Chapter notes", "Unsaved conflict note");
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Switch book" }));
    expect(screen.queryByLabelText("Chapter notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch book" }));
    expect(
      (screen.getByLabelText("Chapter notes") as HTMLTextAreaElement).value,
    ).toBe("Unsaved conflict note");
    fireEvent.click(screen.getByRole("button", { name: "Toggle reader" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle reader" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Save chapter",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Chapter notes") as HTMLTextAreaElement).value,
    ).toBe("Unsaved conflict note");
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenLastCalledWith(
        "save_book_chapter",
        expect.objectContaining({
          input: expect.objectContaining({
            id: existing.id,
            expectedVersion: 2,
            note: "Unsaved conflict note",
          }),
        }),
      ),
    );
  });

  it("offers manual titles and notes before PDF import without inventing chapter titles", async () => {
    render(
      <ChapterIndex bookId="csapp" documentRevision={null} onJump={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Add chapter",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Chapter index/ }));
    expect(screen.getByText(/No chapter titles have been added/)).toBeTruthy();
    add();
    type("Chapter title", "Contents title I entered");
    type("Chapter notes", "My private notes");
    expect(
      screen.getByLabelText("Chapter first PDF page").matches(":disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith(
        "save_book_chapter",
        expect.objectContaining({
          bookId: "csapp",
          input: expect.objectContaining({
            title: "Contents title I entered",
            note: "My private notes",
            expectedVersion: 0,
            pageStart: null,
            documentRevision: null,
          }),
        }),
      ),
    );
  });
  it("edits labels and ordering while preserving identity, notes and self-report status", async () => {
    mock.invoke.mockResolvedValue({
      chapters: [existing],
      documentRevision: "revision-a",
    });
    render(
      <ChapterIndex
        bookId="csapp"
        documentRevision="revision-a"
        pageCount={20}
        currentPage={9}
        onJump={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Add chapter",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Chapter index/ }));
    fireEvent.click(
      screen.getByRole("button", { name: `Edit chapter ${existing.title}` }),
    );
    type("Chapter title", "Corrected title");
    type("Chapter order", "4");
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("save_book_chapter", {
        bookId: "csapp",
        input: expect.objectContaining({
          id: existing.id,
          title: "Corrected title",
          position: 4,
          note: existing.note,
          status: "read",
          expectedVersion: 2,
          pageStart: 3,
          pageEnd: 7,
          documentRevision: "revision-a",
        }),
      }),
    );
  });
  it("opens mapped PDF pages and disables stale revision mappings after replacement", async () => {
    mock.invoke.mockResolvedValue({
      chapters: [existing],
      documentRevision: "revision-a",
    });
    const jump = vi.fn();
    const view = render(
      <ChapterIndex
        bookId="csapp"
        documentRevision="revision-a"
        pageCount={20}
        onJump={jump}
      />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Add chapter",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Chapter index/ }));
    fireEvent.click(screen.getByRole("button", { name: /PDF pages 3–7/ }));
    expect(jump).toHaveBeenCalledWith(3);
    view.rerender(
      <ChapterIndex
        bookId="csapp"
        documentRevision="revision-b"
        pageCount={20}
        onJump={jump}
      />,
    );
    const stale = screen.getByRole("button", {
      name: /Re-map after PDF import/,
    }) as HTMLButtonElement;
    expect(stale.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: `Edit chapter ${existing.title}` }),
    );
    expect(
      (screen.getByLabelText("Chapter notes") as HTMLTextAreaElement).value,
    ).toBe(existing.note);
    type("Chapter notes", "New note without rewriting stale mapping");
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith(
        "save_book_chapter",
        expect.objectContaining({
          input: expect.objectContaining({
            documentRevision: "revision-a",
            pageStart: 3,
            note: "New note without rewriting stale mapping",
          }),
        }),
      ),
    );
  });
  it("keeps failed-save drafts visible and allows explicit discard/reload", async () => {
    mock.invoke.mockImplementation(async (command) => {
      if (command === "save_book_chapter")
        throw { message: "This chapter changed in another window." };
      return { chapters: [], documentRevision: null };
    });
    render(
      <ChapterIndex bookId="csapp" documentRevision={null} onJump={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Add chapter",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    add();
    type("Chapter title", "My unsaved title");
    type("Chapter notes", "Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Chapter notes") as HTMLTextAreaElement).value,
    ).toBe("Keep this draft");
    fireEvent.click(
      screen.getByRole("button", { name: "Discard draft and reload" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Chapter notes")).toBeNull(),
    );
  });
  it("keeps browser preview chapters temporary and makes no storage calls", async () => {
    mock.native = false;
    render(
      <ChapterIndex bookId="csapp" documentRevision={null} onJump={vi.fn()} />,
    );
    add();
    type("Chapter title", "Temporary title");
    fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    await screen.findByText("Temporary title");
    expect(
      screen.getByText(
        /Browser preview: saved chapters clear when you leave this reader/,
      ),
    ).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});
