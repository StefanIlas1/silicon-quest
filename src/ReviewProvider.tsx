import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { native, errorMessage } from "./backend";
import { ReviewContext } from "./Review";
import type { ReviewSummary } from "./Review";
export default function ReviewProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const request = useRef(0);
  function accept(next: ReviewSummary) {
    ++generation.current;
    if (alive.current) {
      setSummary(next);
      setLoading(false);
      setError("");
    }
  }
  async function refresh() {
    if (!native) return;
    const version = generation.current;
    const id = ++request.current;
    if (alive.current) setLoading(true);
    try {
      const next = await invoke<ReviewSummary>("get_review_summary");
      if (
        alive.current &&
        version === generation.current &&
        id === request.current
      ) {
        setSummary(next);
        setError("");
      }
    } catch (e) {
      if (
        alive.current &&
        version === generation.current &&
        id === request.current
      )
        setError(errorMessage(e));
    } finally {
      if (alive.current && id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    if (native) void refresh();
    const interval = native
      ? setInterval(() => void refresh(), 60000)
      : undefined;
    return () => {
      alive.current = false;
      clearInterval(interval);
    };
  }, []);
  return (
    <ReviewContext.Provider
      value={{ summary, loading, error, refresh, accept }}
    >
      {children}
    </ReviewContext.Provider>
  );
}
