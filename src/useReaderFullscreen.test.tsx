import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import useReaderFullscreen from "./useReaderFullscreen";

const mock = vi.hoisted(() => ({
  native: true,
  fullscreen: false,
  setFullscreen: vi.fn(),
  onResized: vi.fn(),
  resize: null as null | (() => void),
  unlisten: vi.fn(),
}));
vi.mock("./backend", () => ({
  get native() {
    return mock.native;
  },
  errorMessage: (error: Error) => error.message,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => mock.fullscreen,
    setFullscreen: mock.setFullscreen,
    onResized: mock.onResized,
  }),
}));
function Harness({
  onError = vi.fn(),
}: {
  onError?: (message: string) => void;
}) {
  const fullscreen = useReaderFullscreen(onError);
  return (
    <>
      <button>Outside reader</button>
      <div
        ref={fullscreen.root}
        role={fullscreen.active ? "dialog" : undefined}
      >
        <button
          ref={fullscreen.toggleButton}
          disabled={fullscreen.busy}
          onClick={() => void fullscreen.toggle()}
        >
          {fullscreen.active ? "Exit" : "Enter"}
        </button>
        <textarea aria-label="Draft" />
        <button>Last control</button>
        <div className="continuous-pdf-stage" />
      </div>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.native = true;
  mock.fullscreen = false;
  mock.resize = null;
  mock.setFullscreen.mockImplementation(async (value: boolean) => {
    mock.fullscreen = value;
  });
  mock.onResized.mockImplementation(async (callback: () => void) => {
    mock.resize = callback;
    return mock.unlisten;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (document as unknown as { fullscreenElement?: Element })
    .fullscreenElement;
});
describe("reader full-screen lifecycle", () => {
  it("contains keyboard navigation and restores outside access and focus", async () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    render(<Harness />);
    const outside = screen.getByRole("button", { name: "Outside reader" });
    outside.inert = false;
    const enter = screen.getByRole("button", { name: "Enter" });
    enter.focus();
    fireEvent.click(enter);
    await screen.findByRole("dialog");
    await waitFor(() => {
      expect(outside.inert).toBe(true);
      expect(document.body.style.overflow).toBe("hidden");
    });
    const last = screen.getByRole("button", { name: "Last control" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(enter);
    fireEvent.keyDown(enter, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await screen.findByRole("button", { name: "Enter" });
    await waitFor(() => {
      expect(outside.inert).toBe(false);
      expect(document.body.style.overflow).toBe("");
      expect(document.activeElement).toBe(enter);
      expect(mock.unlisten).toHaveBeenCalled();
    });
  });
  it("retains an existing native fullscreen window after leaving the reader", async () => {
    mock.fullscreen = true;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await screen.findByRole("button", { name: "Enter" });
    expect(mock.setFullscreen).not.toHaveBeenCalled();
  });
  it("responds to the native macOS window control exiting fullscreen", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(mock.resize).toBeTypeOf("function"));
    mock.fullscreen = false;
    mock.resize?.();
    await screen.findByRole("button", { name: "Enter" });
    expect(mock.setFullscreen).toHaveBeenCalledTimes(1);
  });
  it("reports denied native entry without trapping the learner", async () => {
    const onError = vi.fn();
    mock.setFullscreen.mockRejectedValue(new Error("Denied"));
    render(<Harness onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Could not enter full screen: Denied",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
  it("leaves native fullscreen when the reader unmounts", async () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByRole("dialog");
    view.unmount();
    expect(mock.setFullscreen).toHaveBeenLastCalledWith(false);
  });
  it("uses browser fullscreen and synchronizes a browser Escape exit", async () => {
    mock.native = false;
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: request,
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    const reader = await screen.findByRole("dialog");
    expect(request).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: reader,
    });
    fireEvent(document, new Event("fullscreenchange"));
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    fireEvent(document, new Event("fullscreenchange"));
    await screen.findByRole("button", { name: "Enter" });
    expect(mock.setFullscreen).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown })
      .requestFullscreen;
  });
  it("keeps the exit available after a denied exit and allows retry", async () => {
    const onError = vi.fn();
    render(<Harness onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByRole("dialog");
    mock.setFullscreen.mockRejectedValueOnce(new Error("Window busy"));
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Could not exit full screen: Window busy",
      ),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await screen.findByRole("button", { name: "Enter" });
  });
  it("cleans up a native entry that finishes after reader unmount", async () => {
    let finish: () => void = () => {};
    mock.setFullscreen.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await waitFor(() => expect(mock.setFullscreen).toHaveBeenCalledWith(true));
    view.unmount();
    finish();
    await waitFor(() =>
      expect(mock.setFullscreen).toHaveBeenLastCalledWith(false),
    );
  });
  it("uses the browser exit control without leaving a fullscreen element behind", async () => {
    mock.native = false;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exit,
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    const reader = await screen.findByRole("dialog");
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: reader,
    });
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await screen.findByRole("button", { name: "Enter" });
    expect(exit).toHaveBeenCalledTimes(1);
    delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown })
      .requestFullscreen;
    delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen;
  });
  it("provides a viewport reading mode when browser fullscreen is denied", async () => {
    mock.native = false;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("Embedded preview")),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await screen.findByRole("button", { name: "Enter" });
    expect(mock.setFullscreen).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown })
      .requestFullscreen;
  });
});
