import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api/client.js";
import type { PresetId, Size } from "./api/types.js";

// ---- routing: four paths, no library ----
export type Route = { name: "start" } | { name: "library" } | { name: "new"; preset: PresetId; style?: string } | { name: "project"; id: string };

export function parseRoute(path: string, search = ""): Route {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "new" && (parts[1] === "thumbnail" || parts[1] === "photo" || parts[1] === "graphic"))
    return { name: "new", preset: parts[1], style: new URLSearchParams(search).get("style") ?? undefined };
  if (parts[0] === "library" && !parts[1]) return { name: "library" };
  if (parts[0] === "p" && parts[1]) return { name: "project", id: decodeURIComponent(parts[1]) };
  return { name: "start" };
}
/** Query parameters that belong to the session, not the page, and so survive every navigation. */
const STICKY = ["mock", "speed"];
export function navigate(path: string) {
  // `?mock=1` survives every navigation; a page's own query (`?style=...`) is whatever the path says.
  const [pathname = "/", own = ""] = path.split("?");
  const params = new URLSearchParams(own);
  const current = new URLSearchParams(location.search);
  for (const key of STICKY) if (current.has(key) && !params.has(key)) params.set(key, current.get(key)!);
  const qs = params.toString();
  history.pushState(null, "", pathname + (qs ? `?${qs}` : ""));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function useRoute(): Route {
  const [at, setAt] = useState({ path: location.pathname, search: location.search });
  useEffect(() => {
    const on = () => setAt({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return parseRoute(at.path, at.search);
}

// ---- theme: dark unless the system says light; the toggle overrides and is remembered ----
export type Theme = "dark" | "light";
function systemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const set = document.documentElement.getAttribute("data-theme");
    return set === "light" || set === "dark" ? set : systemTheme();
  });
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("imago-theme", next);
    } catch {
      /* private window: the choice just isn't remembered */
    }
    setTheme(next);
  }, [theme]);
  return [theme, toggle];
}

// ---- errors in plain words ----
const RUN_ERRORS: Record<string, string> = {
  CLAUDE_MISSING: "Claude Code isn't installed on this computer, so there's nobody to design yet. The start page shows how to fix it.",
  CLAUDE_SIGNED_OUT: "Claude Code is signed out. Sign in with your Claude subscription, then send that again.",
  TIMEOUT: "That took too long, so it was stopped. Try again, or ask for something smaller.",
  CANCELLED: "Stopped. Nothing more will change.",
  EXITED: "Claude stopped unexpectedly before it finished. Try sending that again.",
};
const API_ERRORS: Record<string, string> = {
  TURN_RUNNING: "Claude is still working on the last message. Wait for it, or press Stop.",
  NETWORK: "Imago's server isn't answering. Is it still running?",
  NOT_FOUND: "That project doesn't exist any more.",
  HTTP_413: "That file is too big. The limit is 40 MB.",
};
/** The friendly sentence for a failed turn, plus the server's own words when they add something. */
export function runErrorText(code: string, message?: string): { text: string; detail: string } {
  const text = RUN_ERRORS[code] ?? "Something went wrong.";
  const detail = (message ?? "").trim();
  return { text, detail: detail && detail !== text ? detail : "" };
}
export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 409 && !API_ERRORS[e.code]) return API_ERRORS.TURN_RUNNING!;
  if (e instanceof ApiError) return API_ERRORS[e.code] ?? e.message ?? "Something went wrong.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

// ---- small helpers ----
export const fmtSize = (s: Size, scale = 1) => `${Math.round(s.width * scale)} × ${Math.round(s.height * scale)}`;
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** "2 d ago" for a project's card; older than a month shows the date. */
export function shortAgo(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return days > 30 ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: days > 330 ? "numeric" : undefined }) : ago(iso);
}
