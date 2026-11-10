import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { credentials } from "../curriculum/data";
import { native, errorMessage } from "./backend";
export type CredentialStatus =
  "not_started" | "in_progress" | "on_hold" | "completed" | "not_pursuing";
export type CredentialProgress = {
  credentialId: string;
  status: CredentialStatus;
  targetDate: string | null;
  evidenceNote: string;
  evidenceReference: string;
  completedAt: string | null;
  updatedAt: string | null;
  version: number;
};
export type CredentialAction = {
  requestId: string;
  credentialId: string;
  action: "saved" | "catalog_updated";
  createdAt: string;
  snapshot: CredentialProgress;
  definition: unknown;
};
export type CredentialSummary = {
  items: CredentialProgress[];
  history: CredentialAction[];
  totalItems: number;
  inProgressCount: number;
  completedCount: number;
  notPursuingCount: number;
};
export type CredentialMutation = {
  summary: CredentialSummary;
  credentialId: string;
  replayed: boolean;
};
export type CredentialDraft = {
  status: CredentialStatus;
  targetDate: string | null;
  evidenceNote: string;
  evidenceReference: string;
  baseVersion: number;
};
export const savedCredentialDraft = (
  p: CredentialProgress,
): CredentialDraft => ({
  status: p.status,
  targetDate: p.targetDate,
  evidenceNote: p.evidenceNote,
  evidenceReference: p.evidenceReference,
  baseVersion: p.version,
});
export const credentialDraftChanged = (
  a: CredentialDraft,
  b: CredentialDraft,
) =>
  a.status !== b.status ||
  a.targetDate !== b.targetDate ||
  a.evidenceNote !== b.evidenceNote ||
  a.evidenceReference !== b.evidenceReference;
type Pending = { credentialId: string; args: Record<string, unknown> };
type Control = {
  summary: CredentialSummary | null;
  loading: boolean;
  busy: boolean;
  pending: boolean;
  error: string;
  notice: string;
  drafts: Record<string, CredentialDraft>;
  unsavedDraftCount: number;
  selectedId: string;
  select: (id: string) => void;
  setDraft: (id: string, draft: CredentialDraft) => void;
  discardDraft: (id: string) => void;
  refresh: () => Promise<void>;
  save: (
    id: string,
    draft: CredentialDraft,
    confirmCompleted: boolean,
  ) => Promise<void>;
  retry: () => Promise<void>;
};
const inactive: Control = {
  summary: null,
  loading: false,
  busy: false,
  pending: false,
  error: "",
  notice: "",
  drafts: {},
  unsavedDraftCount: 0,
  selectedId: credentials[0].id,
  select: () => {},
  setDraft: () => {},
  discardDraft: () => {},
  refresh: async () => {},
  save: async () => {},
  retry: async () => {},
};
const CredentialContext = createContext<Control>(inactive);
export const useCredentials = () => useContext(CredentialContext);
export default function CredentialProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [summary, setSummary] = useState<CredentialSummary | null>(null),
    [loading, setLoading] = useState(native),
    [busy, setBusy] = useState(false),
    [isPending, setIsPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [drafts, setDrafts] = useState<Record<string, CredentialDraft>>({}),
    [selectedId, select] = useState(credentials[0].id);
  const alive = useRef(true),
    pending = useRef<Pending | null>(null),
    busyRef = useRef(false),
    generation = useRef(0),
    request = useRef(0);
  function setDraft(id: string, draft: CredentialDraft) {
    setDrafts((old) => ({ ...old, [id]: draft }));
  }
  function discardDraft(id: string) {
    setDrafts((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    setError("");
    setNotice("Local draft discarded; the saved course record is loaded.");
  }
  async function refresh() {
    if (!native) return;
    const version = generation.current,
      id = ++request.current;
    if (alive.current) setLoading(true);
    try {
      const next = await invoke<CredentialSummary>("get_credential_summary");
      if (
        alive.current &&
        version === generation.current &&
        id === request.current
      ) {
        setSummary(next);
        if (!pending.current) setError("");
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
  async function execute(action: Pending) {
    if (!native || busyRef.current || !alive.current) return;
    busyRef.current = true;
    pending.current = action;
    setBusy(true);
    setIsPending(true);
    setError("");
    setNotice("");
    try {
      const result = await invoke<CredentialMutation>(
        "save_credential_progress",
        action.args,
      );
      pending.current = null;
      ++generation.current;
      if (!alive.current) return;
      setSummary(result.summary);
      setIsPending(false);
      setError("");
      setLoading(false);
      const returned = result.summary.items.find(
        (p) => p.credentialId === action.credentialId,
      );
      const newer =
        !!returned &&
        returned.version > Number(action.args.expectedVersion) + 1;
      if (!newer)
        setDrafts((old) => {
          const next = { ...old };
          delete next[action.credentialId];
          return next;
        });
      setNotice(
        newer
          ? "Your update was recorded, then this course record changed again. Compare your preserved draft with the current saved state."
          : result.replayed
            ? "Earlier update confirmed. No duplicate history entry was added."
            : "Personal course status and evidence saved. No XP or mastery changed.",
      );
    } catch (e) {
      if (!alive.current) return;
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? String(e.code)
          : "";
      if (
        ["invalid_credential_input", "stale_credential_state"].includes(code)
      ) {
        pending.current = null;
        setIsPending(false);
        await refresh();
      }
      setError(
        `${errorMessage(e)} ${pending.current ? "Retry the same pending update before further edits." : "Your draft remains available for comparison."}`,
      );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function save(id: string, draft: CredentialDraft, confirmCompleted: boolean) {
    if (pending.current) return execute(pending.current);
    return execute({
      credentialId: id,
      args: {
        credentialId: id,
        status: draft.status,
        targetDate: draft.targetDate,
        evidenceNote: draft.evidenceNote,
        evidenceReference: draft.evidenceReference,
        confirmCompleted,
        expectedVersion: draft.baseVersion,
        requestId: crypto.randomUUID(),
      },
    });
  }
  async function retry() {
    if (pending.current) await execute(pending.current);
  }
  useEffect(() => {
    alive.current = true;
    if (native) void refresh();
    return () => {
      alive.current = false;
    };
  }, []);
  const unsavedDraftCount = Object.entries(drafts).filter(([id, d]) => {
    const p = summary?.items.find((p) => p.credentialId === id);
    return !p || credentialDraftChanged(d, savedCredentialDraft(p));
  }).length;
  return (
    <CredentialContext.Provider
      value={{
        summary,
        loading,
        busy,
        pending: isPending,
        error,
        notice,
        drafts,
        unsavedDraftCount,
        selectedId,
        select,
        setDraft,
        discardDraft,
        refresh,
        save,
        retry,
      }}
    >
      {children}
    </CredentialContext.Provider>
  );
}
