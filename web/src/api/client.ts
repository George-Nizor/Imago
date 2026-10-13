import {
  type Api,
  type CreateBody,
  EVENT_NAMES,
  SET_EVENT_NAMES,
  type SetEvent,
  type ExportFile,
  type ExportFormat,
  type FaceUsage,
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
  listFonts: () => call("/api/fonts"),
  listBrands: () => call("/api/brands"),
  createBrand: (body) => call("/api/brands", json("POST", body)),
  updateBrand: (id, patch) => call(`/api/brands/${enc(id)}`, json("PATCH", patch)),
  deleteBrand: async (id) => {
    await call(`/api/brands/${enc(id)}`, { method: "DELETE" });
  },
  uploadBrandAsset: (id, file, meta) =>
    call(`/api/brands/${enc(id)}/assets?kind=${enc(meta.kind)}&note=${enc(meta.note)}`, {
      method: "POST",
      headers: { "x-filename": filenameHeader(file.name), "content-type": file.type || "application/octet-stream" },
      body: file,
    }),
  updateBrandAsset: (id, name, patch) => call(`/api/brands/${enc(id)}/assets/${enc(name)}`, json("PATCH", patch)),
  deleteBrandAsset: async (id, name) => {
    await call(`/api/brands/${enc(id)}/assets/${enc(name)}`, { method: "DELETE" });
  },
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
  feedUrl: (id, n) => `/projects/${enc(id)}/renders/v${n}-feed.png`,
  designUrl: (id, nonce) => `/projects/${enc(id)}/design.html?t=${nonce}`,
  assetUrl: (id, name) => `/projects/${enc(id)}/assets/${enc(name)}`,
  listKits: () => call("/api/kits"),
  createConceptSet: (body) => call("/api/concept-sets", json("POST", body)),
  uploadSetAsset: (id, file) =>
    call(`/api/concept-sets/${enc(id)}/assets`, {
      method: "POST",
      headers: { "x-filename": filenameHeader(file.name), "content-type": file.type || "application/octet-stream" },
      body: file,
    }),
  startConceptSet: (id) => call(`/api/concept-sets/${enc(id)}/start`, json("POST", {})),
  getConceptSet: (id) => call(`/api/concept-sets/${enc(id)}`),
  cancelConceptSet: (id) => call(`/api/concept-sets/${enc(id)}/cancel`, json("POST", {})),
  anotherConcept: (id) => call(`/api/concept-sets/${enc(id)}/another`, json("POST", {})),
  subscribeSet(id, onEvent) {
    const es = new EventSource(`/api/concept-sets/${enc(id)}/events`);
    for (const type of SET_EVENT_NAMES) {
      es.addEventListener(type, (ev) => {
        try {
          onEvent({ type, ...(JSON.parse((ev as MessageEvent<string>).data) as object) } as SetEvent);
        } catch {
          /* ignore a malformed frame */
        }
      });
    }
    return () => es.close();
  },
  testCompare: (id, projects) => call(`/api/concept-sets/${enc(id)}/test-compare`, json("POST", projects ? { projects } : {})),
  listFaces: () => call("/api/faces"),
  uploadFace: (file) =>
    call("/api/faces", {
      method: "POST",
      headers: { "x-filename": filenameHeader(file.name), "content-type": file.type || "application/octet-stream" },
      body: file,
    }),
  patchFace: (id, patch) => call(`/api/faces/${enc(id)}`, json("PATCH", patch)),
  deleteFace: async (id) => {
    await call(`/api/faces/${enc(id)}`, { method: "DELETE" });
  },
  restoreFace: (id) => call(`/api/faces/${enc(id)}/restore`, json("POST", {})),
  reclassifyFaces: (ids) => call("/api/faces/reclassify", json("POST", ids ? { ids } : {})),
  recutFace: (id) => call(`/api/faces/${enc(id)}/recut`, json("POST", {})),
  setFaceSettings: (settings) => call("/api/faces/settings", json("PUT", settings)),
  retouchFaces: (ids) => call("/api/faces/retouch", json("POST", ids ? { ids } : {})),
  platformExport: (id, platforms) => call(`/api/projects/${enc(id)}/platform-export`, json("POST", platforms ? { platforms } : {})),
  quickExport: (id) => call(`/api/projects/${enc(id)}/quick-export`, json("POST", {})),
  listExports: async (id) => (await call<{ items: ExportFile[] }>(`/api/projects/${enc(id)}/exports`)).items,
  deleteExport: async (id, name) => {
    await call(`/api/projects/${enc(id)}/exports/${enc(name)}`, { method: "DELETE" });
  },
  faceStatus: (id) => call(`/api/projects/${enc(id)}/face-status`),
  refreshFaces: (id) => call(`/api/projects/${enc(id)}/refresh-faces`, json("POST", {})),
  faceVariants: (id, body) => call(`/api/projects/${enc(id)}/face-variants`, json("POST", body)),
  pickConcept: (setId, projectId) => call(`/api/concept-sets/${enc(setId)}/pick`, json("POST", { project: projectId })),
  faceUsage: async (id) => (await call<{ items: FaceUsage[] }>(`/api/faces/${enc(id)}/projects`)).items,
  refreshFaceEverywhere: (id) => call(`/api/faces/${enc(id)}/refresh-projects`, json("POST", {})),
};
