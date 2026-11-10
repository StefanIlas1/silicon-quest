import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorMessage, native } from "./backend";

type Mode = "none" | "native" | "browser" | "viewport";

// Keep the reader in place: moving it into a portal would discard PDF canvases,
// scroll position, and unsaved annotation drafts.
export default function useReaderFullscreen(
  onError: (message: string) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const mode = useRef<Mode>("none");
  const changing = useRef(false);
  const mounted = useRef(true);
  const ownsNative = useRef(false);
  const savedScroll = useRef<{ top: number; left: number } | null>(null);
  const error = useRef(onError);
  error.current = onError;

  function rememberScroll() {
    const stage = root.current?.querySelector<HTMLElement>(
      ".continuous-pdf-stage",
    );
    if (stage)
      savedScroll.current = { top: stage.scrollTop, left: stage.scrollLeft };
  }

  async function exit() {
    if (changing.current || mode.current === "none") return;
    changing.current = true;
    setBusy(true);
    setFailure("");
    rememberScroll();
    try {
      if (mode.current === "native" && ownsNative.current)
        await getCurrentWindow().setFullscreen(false);
      if (
        mode.current === "browser" &&
        document.fullscreenElement === root.current
      )
        await document.exitFullscreen();
      ownsNative.current = false;
      mode.current = "none";
      if (mounted.current) setActive(false);
    } catch (e) {
      if (mounted.current) {
        const message = `Could not exit full screen: ${errorMessage(e)}`;
        setFailure(message);
        error.current(message);
      }
    } finally {
      changing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const exitRef = useRef(exit);
  exitRef.current = exit;

  async function enter() {
    if (changing.current || mode.current !== "none" || !root.current) return;
    changing.current = true;
    setBusy(true);
    setFailure("");
    rememberScroll();
    try {
      if (native) {
        const window = getCurrentWindow();
        ownsNative.current = !(await window.isFullscreen());
        if (ownsNative.current) await window.setFullscreen(true);
        mode.current = "native";
      } else if (root.current.requestFullscreen) {
        try {
          await root.current.requestFullscreen();
          mode.current = "browser";
        } catch {
          // Embedded previews and browsers may deny the Fullscreen API.
          mode.current = "viewport";
        }
      } else mode.current = "viewport";
      if (mounted.current) setActive(true);
      else {
        if (ownsNative.current) await getCurrentWindow().setFullscreen(false);
        if (mode.current === "browser" && document.fullscreenElement)
          await document.exitFullscreen();
      }
    } catch (e) {
      ownsNative.current = false;
      if (mounted.current)
        error.current(`Could not enter full screen: ${errorMessage(e)}`);
    } finally {
      changing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useLayoutEffect(() => {
    const stage = root.current?.querySelector<HTMLElement>(
      ".continuous-pdf-stage",
    );
    if (stage && savedScroll.current) {
      stage.scrollTop = savedScroll.current.top;
      stage.scrollLeft = savedScroll.current.left;
      savedScroll.current = null;
    }
  }, [active]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (mode.current === "native" && ownsNative.current)
        void getCurrentWindow()
          .setFullscreen(false)
          .catch(() => {});
      if (
        mode.current === "browser" &&
        document.fullscreenElement === root.current
      )
        void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!active || !root.current) return;
    const reader = root.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const outside: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = reader;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          outside.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    toggleButton.current?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        void exitRef.current();
      } else if (event.key === "Tab") {
        const controls = Array.from(
          reader.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ),
        ).filter(
          (element) => !element.hidden && element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          reader.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === reader)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function browserChange() {
      if (mode.current === "browser" && document.fullscreenElement !== reader) {
        rememberScroll();
        mode.current = "none";
        setActive(false);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("fullscreenchange", browserChange);
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (native) {
      let observedFullscreen = false;
      const window = getCurrentWindow();
      const check = async () => {
        try {
          const fullscreen = await window.isFullscreen();
          if (cancelled || changing.current) return;
          if (fullscreen) observedFullscreen = true;
          else if (observedFullscreen) {
            rememberScroll();
            ownsNative.current = false;
            mode.current = "none";
            setActive(false);
          }
        } catch (e) {
          if (!cancelled)
            error.current(`Full-screen state unavailable: ${errorMessage(e)}`);
        }
      };
      void window
        .onResized(check)
        .then((stop) => {
          if (cancelled) stop();
          else unlisten = stop;
        })
        .catch((e) => {
          if (!cancelled)
            error.current(
              `Full-screen controls unavailable: ${errorMessage(e)}`,
            );
        });
      void check();
    }
    return () => {
      cancelled = true;
      unlisten?.();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("fullscreenchange", browserChange);
      document.body.style.overflow = previousOverflow;
      outside.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      toggleButton.current?.focus({ preventScroll: true });
    };
  }, [active]);

  return {
    root,
    toggleButton,
    active,
    busy,
    failure,
    toggle: () => (active ? exit() : enter()),
  };
}
