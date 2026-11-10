import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ImagePlus, RotateCcw } from "lucide-react";
import { errorMessage, native } from "./backend";
import "./Artwork.css";

export type ArtworkKind = "book" | "course";
type Artwork = {
  bytes: number[];
  width: number;
  height: number;
  updatedAt: string;
};
type Entry = {
  artwork: Artwork | null;
  loaded: boolean;
  error: string;
  busy: boolean;
};
const entries = new Map<string, Entry>();
const requests = new Map<string, symbol>();
const listeners = new Set<() => void>();
const initial: Entry = { artwork: null, loaded: false, error: "", busy: false };
const keyFor = (kind: ArtworkKind, itemId: string) => `${kind}:${itemId}`;
function update(key: string, value: Partial<Entry>) {
  entries.set(key, { ...(entries.get(key) ?? initial), ...value });
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function useArtwork(kind: ArtworkKind, itemId: string) {
  const key = keyFor(kind, itemId);
  const entry = useSyncExternalStore(
    subscribe,
    () => entries.get(key) ?? initial,
  );
  useEffect(() => {
    if (!native || entries.has(key)) return;
    const request = Symbol();
    requests.set(key, request);
    update(key, {});
    void invoke<Artwork | null>("get_local_artwork", { kind, itemId })
      .then((artwork) => {
        if (requests.get(key) === request)
          update(key, { artwork, loaded: true });
      })
      .catch((error) => {
        if (requests.get(key) === request)
          update(key, { error: errorMessage(error), loaded: true });
      });
  }, [kind, itemId, key]);
  return { key, entry };
}

/** A private override around bundled, licensed artwork. Safe to use in buttons. */
export function LocalArtwork({
  kind,
  itemId,
  title,
  fallback,
  className = "",
}: {
  kind: ArtworkKind;
  itemId: string;
  title: string;
  fallback: ReactNode;
  className?: string;
}) {
  const { entry } = useArtwork(kind, itemId);
  const [source, setSource] = useState<{
    artwork: Artwork;
    url: string;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!entry.artwork) {
      setSource(null);
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([new Uint8Array(entry.artwork.bytes)], { type: "image/png" }),
    );
    setSource({ artwork: entry.artwork, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [entry.artwork]);
  if (!source || source.artwork !== entry.artwork || failed)
    return <>{fallback}</>;
  return (
    <span className={`local-artwork ${className}`}>
      <img
        src={source.url}
        alt={`${title} ${kind === "course" ? "artwork" : "cover"}`}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/** Native chooser is intentionally unavailable in browser previews. */
export function ArtworkEditor({
  kind,
  itemId,
  title,
  disabled = false,
}: {
  kind: ArtworkKind;
  itemId: string;
  title: string;
  disabled?: boolean;
}) {
  const { key, entry } = useArtwork(kind, itemId);
  async function mutate(remove: boolean) {
    if (!native || disabled || entry.busy) return;
    update(key, { busy: true, error: "" });
    try {
      if (remove) {
        await invoke("remove_local_artwork", { kind, itemId });
        requests.set(key, Symbol());
        update(key, { artwork: null, loaded: true });
      } else {
        const artwork = await invoke<Artwork | null>("import_local_artwork", {
          kind,
          itemId,
        });
        // Cancelling the native picker preserves the existing image.
        if (artwork) {
          requests.set(key, Symbol());
          update(key, { artwork, loaded: true });
        }
      }
    } catch (error) {
      update(key, { error: errorMessage(error) });
    } finally {
      update(key, { busy: false });
    }
  }
  return (
    <div className="artwork-editor">
      <div className="artwork-editor-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={!native || disabled || entry.busy}
          onClick={() => void mutate(false)}
          aria-label={`Choose local cover for ${title}`}
        >
          <ImagePlus size={13} />
          {entry.busy
            ? "Updating cover…"
            : entry.artwork
              ? "Change local cover"
              : "Choose local cover"}
        </button>
        {entry.artwork && (
          <button
            type="button"
            className="text-button"
            disabled={disabled || entry.busy}
            onClick={() => void mutate(true)}
            aria-label={`Reset cover for ${title}`}
          >
            <RotateCcw size={12} />
            Reset cover
          </button>
        )}
      </div>
      <p className="micro-copy">
        {native
          ? "PNG or JPEG · up to 10 MB. Stored privately on this device and included in your backups."
          : "Open the desktop app to choose your own cover image."}
      </p>
      {entry.error && (
        <p className="artwork-error" role="alert">
          {entry.error}
        </p>
      )}
    </div>
  );
}
