import { useState } from "react";
import type { Credit, FurtherModel, Project } from "./api/types.js";

export const FURTHER_MODELS: { id: FurtherModel; label: string }[] = [
  { id: "opus", label: "Opus 5.5" },
  { id: "fable", label: "Fable 5.1" },
];
const KEY = "imago.furtherModel";

/** "Opus 5.5" for a model id the server recorded; the id itself when it is not one we know. */
export function modelLabel(id: string): string {
  if (/opus/i.test(id)) return "Opus 5.5";
  if (/fable/i.test(id)) return "Fable 5.1";
  if (/sonnet/i.test(id)) return "Sonnet 5.5";
  return id;
}

export function useFurtherModel(): [FurtherModel, (m: FurtherModel) => void] {
  const [model, setModel] = useState<FurtherModel>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "fable" ? "fable" : "opus";
    } catch {
      return "opus";
    }
  });
  return [
    model,
    (m) => {
      setModel(m);
      try {
        localStorage.setItem(KEY, m);
      } catch {
        /* storage can be unavailable; the choice just is not remembered */
      }
    },
  ];
}

const licenseShort = (license: string) => license.replace(/^CC\s+/i, "CC ").trim();

/** "Includes images by A (CC BY 4.0) and B (CC0 1.0)"; empty when nothing needs a credit. */
export function creditLine(credits: Credit[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of credits) {
    const who = c.credit || c.source || "an unknown author";
    const text = c.license ? `${who} (${licenseShort(c.license)})` : who;
    if (!seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  if (!parts.length) return "";
  return `Includes images by ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}`;
}

export const stockCredits = (project: Project): Credit[] =>
  project.assets
    .filter((a) => a.credit !== undefined)
    .map((a) => ({ name: a.name, credit: a.credit ?? "", license: a.license ?? "", licenseUrl: a.licenseUrl ?? "", source: a.source ?? "" }));

