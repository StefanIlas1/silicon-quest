import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { RestoredBackupScreen } from "./BackupPanel";
import type { BackupStatus, RestartState } from "./BackupPanel";
import { RestoreContext } from "./restoreContext";
import { invoke } from "@tauri-apps/api/core";
import { native, errorMessage } from "./backend";
export default function RestoreBoundary({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState<RestartState | null>(null);
  const [checking, setChecking] = useState(native);
  const [error, setError] = useState("");
  const request = useRef(0);
  async function check() {
    const id = ++request.current;
    setChecking(true);
    setError("");
    try {
      const status = await invoke<BackupStatus>("get_backup_status");
      if (typeof status?.restartRequired !== "boolean")
        throw new Error("Workspace status response was incomplete.");
      if (id === request.current && status.restartRequired) setRestored(status);
    } catch (e) {
      if (id === request.current) setError(errorMessage(e));
    } finally {
      if (id === request.current) setChecking(false);
    }
  }
  useEffect(() => {
    if (native) void check();
    return () => {
      ++request.current;
    };
  }, []);
  return (
    <RestoreContext.Provider value={setRestored}>
      {restored ? (
        <RestoredBackupScreen restored={restored} />
      ) : checking || error ? (
        <main className="workspace-restart-check document-empty">
          <div className="empty-icon">
            <span>SI</span>
          </div>
          <h2>
            {checking
              ? "Checking your local workspace…"
              : "The local workspace could not be checked."}
          </h2>
          <p>
            {checking
              ? "Learning data opens after the app checks whether a restart is required."
              : error}
          </p>
          {!checking && (
            <button className="secondary-button" onClick={check}>
              Retry workspace check
            </button>
          )}
        </main>
      ) : (
        children
      )}
    </RestoreContext.Provider>
  );
}
