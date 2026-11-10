import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ArtworkEditor, LocalArtwork } from "./Artwork";
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
const artwork = {
  bytes: [1, 2, 3],
  width: 10,
  height: 20,
  updatedAt: "2026-11-10T12:00:00Z",
};
beforeEach(() => {
  mock.native = true;
  mock.invoke.mockReset();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:private-artwork"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function view(id: string) {
  return (
    <>
      <LocalArtwork
        kind="book"
        itemId={id}
        title={id}
        fallback={<span>Bundled cover</span>}
      />
      <ArtworkEditor kind="book" itemId={id} title={id} />
    </>
  );
}
it("shows local image, preserves on picker cancellation, then resets to bundled cover", async () => {
  mock.invoke.mockImplementation(async (command) =>
    command === "get_local_artwork" ? artwork : null,
  );
  render(view("local-one"));
  await screen.findByAltText("local-one cover");
  fireEvent.click(
    screen.getByRole("button", { name: "Choose local cover for local-one" }),
  );
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("import_local_artwork", {
      kind: "book",
      itemId: "local-one",
    }),
  );
  await waitFor(() =>
    expect(screen.getByAltText("local-one cover")).toBeTruthy(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Reset cover for local-one" }),
  );
  await waitFor(() =>
    expect(screen.queryByAltText("local-one cover")).toBeNull(),
  );
  expect(screen.getByText("Bundled cover")).toBeTruthy();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-artwork");
});
it("retains imported cover when an earlier load finishes late", async () => {
  let finish!: (value: null) => void;
  mock.invoke.mockImplementation((command) =>
    command === "get_local_artwork"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(artwork),
  );
  render(view("race-two"));
  fireEvent.click(
    screen.getByRole("button", { name: "Choose local cover for race-two" }),
  );
  await screen.findByAltText("race-two cover");
  finish(null);
  await waitFor(() =>
    expect(screen.getByAltText("race-two cover")).toBeTruthy(),
  );
});
it("shows native validation failures without losing the prior image", async () => {
  mock.invoke.mockImplementation(async (command) => {
    if (command === "get_local_artwork") return artwork;
    throw { message: "Choose a valid PNG or JPEG." };
  });
  render(view("invalid-three"));
  await screen.findByAltText("invalid-three cover");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose local cover for invalid-three",
    }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Choose a valid PNG or JPEG.",
  );
  expect(screen.getByAltText("invalid-three cover")).toBeTruthy();
});
it("leaves preview read-only and makes no native request", () => {
  mock.native = false;
  render(view("preview-four"));
  expect(screen.getByText("Bundled cover")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Choose local cover for preview-four",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("describes course imagery as artwork without claiming a distinct course cover", async () => {
  mock.invoke.mockResolvedValue(artwork);
  render(
    <LocalArtwork
      kind="course"
      itemId="course-alt-five"
      title="GPU training"
      fallback={<span>Provider artwork</span>}
    />,
  );
  expect(await screen.findByAltText("GPU training artwork")).toBeTruthy();
  expect(screen.queryByAltText("GPU training cover")).toBeNull();
});
