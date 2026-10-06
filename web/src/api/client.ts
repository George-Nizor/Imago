import {
  type Api,
  type CreateBody,
  EVENT_NAMES,
  type ExportFormat,
  type ServerEvent,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("NETWORK", "Imago's server isn't answering.");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText, res.status);
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const enc = encodeURIComponent;
/** The server decodeURIComponent()s x-filename and sanitises it itself; headers must be ASCII. */
const filenameHeader = (name: string) => enc(name || "pasted.png");

export const realApi: Api = {
  capabilities: () => call("/api/capabilities"),
  presets: () => call("/api/presets"),
  listProjects: (q = {}) => {
    const params = new URLSearchParams();
    if (q.query?.trim()) params.set("query", q.query.trim());
    if (q.preset) params.set("preset", q.preset);
    if (q.series) params.set("series", q.series);
    if (q.starred) params.set("starred", "1");
    if (q.sort) params.set("sort", q.sort);
    if (q.offset) params.set("offset", String(q.offset));
    if (q.limit) params.set("limit", String(q.limit));
    const qs = params.toString();
    return call(`/api/projects${qs ? `?${qs}` : ""}`);
  },
  patchProject: (id, patch) => call(`/api/projects/${enc(id)}`, json("PATCH", patch)),
  duplicateProject: (id) => call(`/api/projects/${enc(id)}/duplicate`, json("POST", {})),
  newInStyle: (id, body) => call(`/api/projects/${enc(id)}/new-in-style`, json("POST", body)),
  bulk: (action, ids, series) => call("/api/projects/bulk", json("POST", { action, ids, ...(series !== undefined && { series }) })),
  exportZipUrl: (ids) => `/api/projects/export.zip?ids=${ids.map(enc).join(",")}`,
  listSeries: () => call("/api/series"),
  createSeries: (name) => call("/api/series", json("POST", { name })),
  updateSeries: (id, patch) => call(`/api/series/${enc(id)}`, json("PATCH", patch)),
  deleteSeries: async (id) => {
    await call(`/api/series/${enc(id)}`, { method: "DELETE" });
  },
  createProject: (body: CreateBody) => call("/api/projects", json("POST", body)),
  getProject: (id) => call(`/api/projects/${enc(id)}`),
  deleteProject: async (id) => {
    await call(`/api/projects/${enc(id)}`, { method: "DELETE" });
  },
  uploadAsset: (id, file) =>
    call(`/api/projects/${enc(id)}/assets`, {
      method: "POST",
      headers: { "x-filename": filenameHeader(file.name), "content-type": file.type || "application/octet-stream" },
      body: file,
    }),
  cutout: (id, name) => call(`/api/projects/${enc(id)}/assets/${enc(name)}/cutout`, { method: "POST" }),
  sendMessage: async (id, text, opts) => {
    const body = opts?.mode === "further" ? { text, mode: "further", model: opts.model ?? "opus" } : { text };
    await call(`/api/projects/${enc(id)}/messages`, json("POST", body));
  },
  cancel: async (id) => {
    await call(`/api/projects/${enc(id)}/cancel`, { method: "POST" });
  },
  restore: (id, version) => call(`/api/projects/${enc(id)}/restore`, json("POST", { version })),
  exportProject: (id, body: { format: ExportFormat; scale: number }) =>
    call(`/api/projects/${enc(id)}/export`, json("POST", body)),
  subscribe(id, onEvent) {
    const es = new EventSource(`/api/projects/${enc(id)}/events`);
    for (const type of EVENT_NAMES) {
      es.addEventListener(type, (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent<string>).data) as object;
          onEvent({ type, ...data } as ServerEvent);
        } catch {
          /* ignore a malformed frame */
        }
      });
    }
    return () => es.close();
  },
  renderUrl: (id, n) => `/projects/${enc(id)}/renders/v${n}.png`,
  designUrl: (id, nonce) => `/projects/${enc(id)}/design.html?t=${nonce}`,
  assetUrl: (id, name) => `/projects/${enc(id)}/assets/${enc(name)}`,
};
