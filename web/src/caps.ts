import { createContext, useContext } from "react";
import type { Capabilities } from "./api/types.js";

export interface CapsState {
  caps: Capabilities | null;
  error: string;
  checking: boolean;
  recheck: () => void;
}
export const CapsContext = createContext<CapsState>({ caps: null, error: "", checking: false, recheck: () => {} });
export const useCaps = () => useContext(CapsContext);
/** True when Claude and the renderer are both ready (or not yet known: the server then decides). */
export const canCreate = (c: Capabilities | null) => !c || (c.claude.state === "ready" && c.renderer.state === "ready");
