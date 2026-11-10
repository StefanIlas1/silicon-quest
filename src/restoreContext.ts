import { createContext } from "react";
import type { RestartState } from "./BackupPanel";
/** Successful restore tears down all stateful learner providers before restart. */
export const RestoreContext = createContext<
  ((result: RestartState) => void) | null
>(null);
