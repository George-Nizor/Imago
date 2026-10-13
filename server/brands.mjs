import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { UploadError, isImageName, writeUnique } from "./assets.mjs";
import { EXTENSION, MAX_PIXELS, imageInfo, tooManyPixels } from "./image-info.mjs";
import { isProjectId, isSafeLeaf, sanitizeLeaf } from "./paths.mjs";

export class BrandError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const BRAND_ROLES = ["primary", "accent", "ink", "light", "extra"];
export const ASSET_KINDS = ["logo", "mascot", "other"];
export const LIMITS = { brands: 50, colours: 12, devices: 12, assets: 20, name: 60, description: 600, colourName: 40, device: 240, guidance: 4000, note: 240, settings: 200 };
export const SNAPSHOT_FILE = "reference/brand.json";
/** A brand asset copied into a project is named `brand-<name>` and has kind "brand". */
export const BRAND_ASSET_PREFIX = "brand-";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// One or more `"TAG" value` pairs: the font-variation-settings grammar, with plain numbers only.
const SETTINGS = /^"[A-Za-z0-9 ]{4}"\s+-?\d+(\.\d+)?(\s*,\s*"[A-Za-z0-9 ]{4}"\s+-?\d+(\.\d+)?)*$/;

const slug = (name) =>
  String(name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "brand";

// Whitespace is collapsed for one-line fields; control characters never survive.
const oneLine = (value, max) => (typeof value === "string" ? value.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const multiLine = (value, max) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n\t]/gu, "").trim().slice(0, max) : "");

/** fonts.json's families, read fresh (the file is small and the owner may edit it). */
export function readFontCatalog(fontsDir) {
  try {
    return JSON.parse(readFileSync(path.join(fontsDir, "fonts.json"), "utf8")).families ?? [];
  } catch {
    return [];
  }
}

/** The axis tags a family can be set on: its own `axes`, plus wght when variable and wdth when it stretches. */
export function axesOf(font) {
  const tags = new Set(Object.keys(font.axes ?? {}));
  if (font.variable) tags.add("wght");
  if (font.stretch) tags.add("wdth");
  return tags;
}

function checkFont(slot, raw, catalog, { required }) {
  if (raw === undefined || raw === null) {
    if (required) throw new BrandError("BAD_FONT", `fonts.${slot} is required.`);
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) throw new BrandError("BAD_FONT", `fonts.${slot} must be {family, weight?, settings?}.`);
  const font = catalog.find((f) => f.family === raw.family);
  if (!font) throw new BrandError("UNKNOWN_FONT", `fonts.${slot}.family "${String(raw.family).slice(0, 60)}" is not in fonts.json.`);
  const out = { family: font.family };
  if (raw.weight !== undefined && raw.weight !== null && raw.weight !== "") {
    const weight = Number(raw.weight);
    const [lo, hi] = [Math.min(...font.weights), Math.max(...font.weights)];
    const fits = font.variable ? weight >= lo && weight <= hi : font.weights.includes(weight);
    if (!Number.isInteger(weight) || !fits) throw new BrandError("BAD_WEIGHT", `${font.family} has ${font.variable ? `weights ${lo} to ${hi}` : `weight ${font.weights.join(", ")}`}; fonts.${slot}.weight ${raw.weight} is outside that.`);
    out.weight = weight;
  }
  if (raw.settings !== undefined && raw.settings !== null && String(raw.settings).trim() !== "") {
    const settings = typeof raw.settings === "string" ? raw.settings.trim() : "";
    if (!settings || settings.length > LIMITS.settings || !SETTINGS.test(settings)) throw new BrandError("BAD_SETTINGS", `fonts.${slot}.settings must look like "SOFT" 100, "WONK" 1.`);
    const allowed = axesOf(font);
    for (const [, tag] of settings.matchAll(/"([^"]+)"/g)) {
      if (!allowed.has(tag)) throw new BrandError("BAD_SETTINGS", `${font.family} has no "${tag}" axis${allowed.size ? ` (it has ${[...allowed].join(", ")})` : ""}.`);
    }
    out.settings = settings;
  }
  return out;
}

/**
 * Checks and normalises the editable fields of a brand (not its assets or default flag). With
 * `partial`, only the fields given are checked and returned.
 */
export function validateBrandFields(input, catalog, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BrandError("BAD_BRAND", "A brand is a JSON object.");
  const has = (key) => !partial || input[key] !== undefined;
  const out = {};
  if (has("name")) {
    out.name = oneLine(input.name, LIMITS.name);
    if (!out.name) throw new BrandError("BAD_NAME", "A brand needs a name.");
  }
  if (has("description")) out.description = multiLine(input.description ?? "", LIMITS.description);
  if (has("colours")) {
    if (!Array.isArray(input.colours) || !input.colours.length) throw new BrandError("BAD_COLOURS", "A brand needs at least one colour.");
    if (input.colours.length > LIMITS.colours) throw new BrandError("BAD_COLOURS", `A brand has at most ${LIMITS.colours} colours.`);
    out.colours = input.colours.map((c, i) => {
      if (!c || typeof c !== "object") throw new BrandError("BAD_COLOURS", `colours[${i}] must be {name, hex, role}.`);
      if (typeof c.hex !== "string" || !HEX.test(c.hex.trim())) throw new BrandError("BAD_HEX", `colours[${i}].hex must be a hex colour such as #00BCAB.`);
      if (!BRAND_ROLES.includes(c.role)) throw new BrandError("BAD_ROLE", `colours[${i}].role must be one of ${BRAND_ROLES.join(", ")}.`);
      let hex = c.hex.trim().toUpperCase();
      if (hex.length === 4) hex = `#${[...hex.slice(1)].map((d) => d + d).join("")}`;
      return { name: oneLine(c.name, LIMITS.colourName) || hex, hex, role: c.role };
    });
  }
  if (has("fonts")) {
    const fonts = input.fonts;
    if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) throw new BrandError("BAD_FONT", "fonts must be {display, support, mono?}.");
    out.fonts = { display: checkFont("display", fonts.display, catalog, { required: true }), support: checkFont("support", fonts.support, catalog, { required: true }) };
    const mono = checkFont("mono", fonts.mono, catalog, { required: false });
    if (mono) out.fonts.mono = mono;
  }
  if (has("devices")) {
    const devices = input.devices ?? [];
    if (!Array.isArray(devices) || devices.length > LIMITS.devices || devices.some((d) => typeof d !== "string")) throw new BrandError("BAD_DEVICES", `devices is a list of at most ${LIMITS.devices} short strings.`);
    out.devices = devices.map((d) => oneLine(d, LIMITS.device)).filter(Boolean);
  }
  if (has("guidance")) out.guidance = multiLine(input.guidance ?? "", LIMITS.guidance);
  return out;
}

const validDefaultFlag = (value) => {
  if (typeof value !== "boolean") throw new BrandError("BAD_DEFAULT", "isDefault must be true or false.");
  return value;
};

/** The brand as the API and the UI see it: assets get a url. */
export const brandView = (brand) => ({ ...brand, assets: (brand.assets ?? []).map((a) => ({ ...a, url: `/brands/${brand.id}/assets/${a.name}` })) });

const normaliseAssetKind = (kind) => {
  if (kind === undefined || kind === null || kind === "") return "other";
  if (!ASSET_KINDS.includes(kind)) throw new BrandError("BAD_KIND", `kind must be one of ${ASSET_KINDS.join(", ")}.`);
  return kind;
};

/**
 * `<dataDir>/brands/brands.json` and `<dataDir>/brands/<id>/assets/`. Every change is serialised and the
 * file lands atomically. The server is the only writer.
 */
export function createBrands({ config }) {
  const root = path.join(config.dataDir, "brands");
  const file = path.join(root, "brands.json");
  const dirOf = (id) => {
    if (!isProjectId(id)) throw new BrandError("BAD_ID", "Invalid brand id.");
    return path.join(root, id);
  };
  const assetsDirOf = (id) => path.join(dirOf(id), "assets");
  let queue = Promise.resolve();

  async function readAll() {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      const list = Array.isArray(data?.brands) ? data.brands : [];
      return list.filter((b) => b && isProjectId(b.id) && typeof b.name === "string");
    } catch {
      return [];
    }
  }

  function change(fn) {
    const run = queue.then(async () => {
      const list = await readAll();
      const result = await fn(list);
      await fs.mkdir(root, { recursive: true });
      const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ schemaVersion: 1, brands: list }, null, 2)}\n`);
      await fs.rename(tmp, file);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  const find = (list, id) => {
    const brand = list.find((b) => b.id === id);
    if (!brand) throw new BrandError("NOT_FOUND", "No such brand.", 404);
    return brand;
  };
  const clearDefault = (list, except) => {
    for (const b of list) if (b.id !== except) b.isDefault = false;
  };

  const api = {
    dirOf,
    assetsDirOf,

    async list() {
      const list = await readAll();
      return { items: list.map(brandView), defaultId: list.find((b) => b.isDefault)?.id ?? null };
    },

    async get(id) {
      if (!isProjectId(id)) throw new BrandError("BAD_ID", "Invalid brand id.");
      return brandView(find(await readAll(), id));
    },

    /** The stored brand (no urls) and its assets folder, for snapshotting; 400 BAD_BRAND when it does not exist. */
    async resolve(id) {
      if (typeof id !== "string" || !isProjectId(id)) throw new BrandError("BAD_BRAND", "There is no such brand.");
      const brand = (await readAll()).find((b) => b.id === id);
      if (!brand) throw new BrandError("BAD_BRAND", "There is no such brand.");
      return { brand, dir: assetsDirOf(id) };
    },

    async create(input = {}) {
      const fields = validateBrandFields(input, readFontCatalog(config.fontsDir));
      const isDefault = input.isDefault === undefined ? false : validDefaultFlag(input.isDefault);
      return brandView(
        await change((list) => {
          if (list.length >= LIMITS.brands) throw new BrandError("TOO_MANY", `At most ${LIMITS.brands} brands.`, 409);
          if (list.some((b) => b.name.toLowerCase() === fields.name.toLowerCase())) throw new BrandError("EXISTS", `There is already a brand called "${fields.name}".`, 409);
          let id = `${slug(fields.name)}-${randomBytes(2).toString("hex")}`;
          while (list.some((b) => b.id === id)) id = `${slug(fields.name)}-${randomBytes(2).toString("hex")}`;
          const now = new Date().toISOString();
          const brand = { id, ...fields, assets: [], isDefault, createdAt: now, updatedAt: now };
          if (isDefault) clearDefault(list, id);
          list.push(brand);
          return brand;
        }),
      );
    },

    async update(id, input = {}) {
      if (!isProjectId(id)) throw new BrandError("BAD_ID", "Invalid brand id.");
      const fields = validateBrandFields(input, readFontCatalog(config.fontsDir), { partial: true });
      const isDefault = input.isDefault === undefined ? undefined : validDefaultFlag(input.isDefault);
      return brandView(
        await change((list) => {
          const brand = find(list, id);
          if (fields.name && list.some((b) => b.id !== id && b.name.toLowerCase() === fields.name.toLowerCase())) throw new BrandError("EXISTS", `There is already a brand called "${fields.name}".`, 409);
          Object.assign(brand, fields);
          if (isDefault !== undefined) {
            brand.isDefault = isDefault;
            if (isDefault) clearDefault(list, id);
          }
          brand.updatedAt = new Date().toISOString();
          return brand;
        }),
      );
    },

    async remove(id) {
      if (!isProjectId(id)) throw new BrandError("BAD_ID", "Invalid brand id.");
      await change((list) => {
        list.splice(list.indexOf(find(list, id)), 1);
      });
      await fs.rm(dirOf(id), { recursive: true, force: true });
    },

    /** Stores an image under the brand (safe name, extension from the real type). `maxBytes` is the caller's body limit. */
    async addAsset(id, filename, bytes, { kind, note } = {}) {
      if (!isProjectId(id)) throw new BrandError("BAD_ID", "Invalid brand id.");
      const assetKind = normaliseAssetKind(kind);
      const info = imageInfo(bytes);
      if (!info) throw new UploadError("UNSUPPORTED_IMAGE", "Only PNG, JPEG or WebP images can be uploaded.", 415);
      if (tooManyPixels(info)) throw new UploadError("IMAGE_TOO_LARGE", `Images over ${MAX_PIXELS / 1_000_000} megapixels cannot be used (this one is ${info.width}×${info.height}).`, 413);
      find(await readAll(), id);
      const dir = assetsDirOf(id);
      await fs.mkdir(dir, { recursive: true });
      const stem = sanitizeLeaf(filename, "image").replace(/\.[^.]*$/, "") || "image";
      const wanted = `${stem.slice(0, 60)}.${EXTENSION[info.type]}`;
      // The file is claimed before the record is written; a refused or failed record removes it again.
      const name = await writeUnique(dir, isSafeLeaf(wanted) ? wanted : `image.${EXTENSION[info.type]}`, bytes);
      try {
        return await change((list) => {
          const brand = find(list, id);
          if (brand.assets.length >= LIMITS.assets) throw new BrandError("TOO_MANY", `A brand has at most ${LIMITS.assets} assets.`, 409);
          const asset = { name, kind: assetKind, note: oneLine(note, LIMITS.note), width: info.width, height: info.height };
          brand.assets.push(asset);
          brand.updatedAt = new Date().toISOString();
          return { ...asset, url: `/brands/${id}/assets/${name}` };
        });
      } catch (error) {
        await fs.rm(path.join(dir, name), { force: true });
        throw error;
      }
    },

    async updateAsset(id, name, { kind, note } = {}) {
      if (!isProjectId(id) || !isSafeLeaf(name)) throw new BrandError("BAD_ID", "Invalid brand or asset name.");
      const assetKind = kind === undefined ? undefined : normaliseAssetKind(kind);
      return change((list) => {
        const brand = find(list, id);
        const asset = brand.assets.find((a) => a.name === name);
        if (!asset) throw new BrandError("NOT_FOUND", "No such asset.", 404);
        if (assetKind !== undefined) asset.kind = assetKind;
        if (note !== undefined) asset.note = oneLine(note, LIMITS.note);
        brand.updatedAt = new Date().toISOString();
        return { ...asset, url: `/brands/${id}/assets/${name}` };
      });
    },

    async removeAsset(id, name) {
      if (!isProjectId(id) || !isSafeLeaf(name)) throw new BrandError("BAD_ID", "Invalid brand or asset name.");
      await change((list) => {
        const brand = find(list, id);
        const at = brand.assets.findIndex((a) => a.name === name);
        if (at < 0) throw new BrandError("NOT_FOUND", "No such asset.", 404);
        brand.assets.splice(at, 1);
        brand.updatedAt = new Date().toISOString();
      });
      await fs.rm(path.join(assetsDirOf(id), name), { force: true });
    },

    /** The path of an asset the brand declares (images only), or null: nothing else in the folder is served. */
    async servable(id, leaf) {
      if (!isProjectId(id) || !isSafeLeaf(leaf) || !isImageName(leaf)) return null;
      const brand = (await readAll()).find((b) => b.id === id);
      return brand?.assets.some((a) => a.name === leaf) ? path.join(assetsDirOf(id), leaf) : null;
    },
  };
  return api;
}

// ---- the snapshot a project (or a concept set's planner folder) keeps ------------------------------

/** What `reference/brand.json` holds: the brand's design fields and, for each asset, the file it was copied to. */
export function snapshotOf(brand, now = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    id: brand.id,
    name: brand.name,
    description: brand.description ?? "",
    colours: structuredClone(brand.colours),
    fonts: structuredClone(brand.fonts),
    devices: [...(brand.devices ?? [])],
    guidance: brand.guidance ?? "",
    assets: (brand.assets ?? []).map((a) => ({ name: a.name, file: `${BRAND_ASSET_PREFIX}${a.name}`, kind: a.kind, note: a.note ?? "", width: a.width, height: a.height })),
    snapshotAt: now,
  };
}

async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, target);
}

/** The snapshot in a project (or planner) folder, or null when there is none or it is unreadable. */
export async function readSnapshot(dir) {
  try {
    const snap = JSON.parse(await fs.readFile(path.join(dir, SNAPSHOT_FILE), "utf8"));
    return snap && typeof snap === "object" && Array.isArray(snap.colours) && snap.fonts ? snap : null;
  } catch {
    return null;
  }
}

/**
 * Copies the snapshot's asset files (as `brand-<name>`) into `toDir/assets/` and writes `toDir/reference/brand.json`.
 * An asset whose file has gone missing is dropped from the snapshot rather than failing the project. Returns what was written.
 */
export async function writeSnapshotFiles(toDir, snapshot, assetsFrom, { fileOf = (a) => a.name } = {}) {
  await fs.mkdir(path.join(toDir, "assets"), { recursive: true });
  const kept = [];
  for (const a of snapshot.assets) {
    try {
      await fs.copyFile(path.join(assetsFrom, fileOf(a)), path.join(toDir, "assets", a.file));
      kept.push(a);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const written = { ...snapshot, assets: kept };
  await writeJsonAtomic(path.join(toDir, SNAPSHOT_FILE), written);
  return written;
}

const assetRecords = (snapshot) =>
  snapshot.assets.map((a) => ({ name: a.file, kind: "brand", width: a.width, height: a.height, from: null, brandKind: a.kind, note: a.note }));

/**
 * Snapshots `brand` into project `id`: reference/brand.json, the assets as `brand-<name>` and the
 * project's `brand` field. Editing the brand later changes none of it.
 */
export async function snapshotIntoProject(store, id, brand, assetsFrom) {
  const snapshot = await writeSnapshotFiles(store.dirOf(id), snapshotOf(brand), assetsFrom);
  await store.mutate(id, (p) => {
    p.assets = p.assets.filter((a) => a.kind !== "brand");
    p.assets.push(...assetRecords(snapshot));
    p.brand = { id: snapshot.id, name: snapshot.name };
  }, { touch: false });
  return snapshot;
}

/** Copies a donor project's snapshot (and the assets it names) into another project, as it is. */
export async function cloneSnapshot(store, fromId, toId) {
  const from = store.dirOf(fromId);
  const found = await readSnapshot(from);
  if (!found) return null;
  const donor = await store.read(fromId);
  const snapshot = await writeSnapshotFiles(store.dirOf(toId), found, path.join(from, "assets"), { fileOf: (a) => a.file });
  await store.mutate(toId, (p) => {
    p.assets = p.assets.filter((a) => a.kind !== "brand");
    p.assets.push(...assetRecords(snapshot));
    p.brand = donor.brand ?? { id: snapshot.id, name: snapshot.name };
  }, { touch: false });
  return snapshot;
}

/** Copies the snapshot and its asset files from one folder to another (a project to a planner folder); no project.json is involved. */
export async function copySnapshotFiles(fromDir, toDir) {
  const found = await readSnapshot(fromDir);
  if (!found) return null;
  return writeSnapshotFiles(toDir, found, path.join(fromDir, "assets"), { fileOf: (a) => a.file });
}
