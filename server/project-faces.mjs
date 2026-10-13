// What the server does with the faces inside a project, without the owner typing to Claude: noticing that the
// pack's copy is newer ("Refresh faces", rendered locally with no turn) and "Try other faces" (the same design
// duplicated once per face, one locked-down face-swap turn each, grouped as a set for the compare screen).
import fs from "node:fs/promises";
import path from "node:path";
import { registerFace } from "./assets.mjs";
import { faceStatus, isFaceId, pickVariantFaces, readAllFaces, readFace, takeFace, usable } from "./face-pack.mjs";
import { formatOf } from "./feed.mjs";
import { RenderError } from "./renderer.mjs";
import { renderVersion } from "./render-version.mjs";

export class ProjectFaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const MAX_VARIANTS = 6;
const faceAssets = (project, only) => project.assets.filter((a) => a.kind === "face" && a.faceId && (!only || a.faceId === only));
const sentence = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);

/**
 * `ctx`: {config, store, sets, busy(id), takeSlot(id), emit(id, event, data)}. `busy` and `takeSlot` are the server's
 * one-turn-per-project slot, so a refresh never overlaps a turn, a restore or an export.
 */
export function createProjectFaces(ctx) {
  const { config, store, sets } = ctx;

  /** Is each pack face in this project older than the pack's? `{faces: [{id, state: current|stale|unavailable, assets, reason?}], stale}`. */
  async function status(id) {
    const project = await store.read(id);
    const faces = await faceStatus(config.dataDir, store.dirOf(id), project.assets);
    return { faces, stale: faces.filter((f) => f.state === "stale").length };
  }

  /**
   * Copies the project's pack faces again from the pack (each keeps its mirror and sticker variant), renders design.html as a
   * new version with no Claude turn and records it like a render from a turn. `only` limits it to one face id.
   * Returns {project, version, refreshed: [name], skipped: [{name, reason}]}.
   */
  async function refresh(id, { only } = {}) {
    if (ctx.busy(id)) throw new ProjectFaceError("TURN_RUNNING", "A turn is running; refresh the faces after it finishes.", 409);
    // The slot is taken before any await, so a message cannot start a turn halfway through.
    const slot = ctx.takeSlot(id);
    try {
      const project = await store.read(id);
      const wanted = faceAssets(project, only);
      if (!wanted.length) throw new ProjectFaceError("NO_FACES", "This design has no face from your face pack.", 409);
      const dir = store.dirOf(id);
      const refreshed = [];
      const skipped = [];
      for (const a of wanted) {
        try {
          const made = await takeFace(config.dataDir, dir, a.faceId, { mirror: a.mirrored === true, sticker: a.sticker ?? false });
          await registerFace(store, id, { name: made.name, width: made.width, height: made.height, faceId: a.faceId, mirrored: made.mirrored, stamp: made.stamp, sticker: made.sticker, display: made.display });
          refreshed.push(made.name);
        } catch (error) {
          skipped.push({ name: a.name, reason: error.message });
        }
      }
      if (!refreshed.length) throw new ProjectFaceError("NOTHING_REFRESHED", skipped.map((s) => `${s.name}: ${s.reason}`).join(" "), 409);
      let rendered;
      try {
        rendered = await renderVersion(config, {
          dir,
          size: project.size,
          preset: project.preset,
          format: formatOf(project),
          title: String(project.brief?.title ?? project.title ?? "").slice(0, 300),
          id,
          conceptSetId: typeof project.conceptSet?.id === "string" ? project.conceptSet.id : null,
        });
      } catch (error) {
        if (error instanceof RenderError) throw new ProjectFaceError("RENDER_FAILED", error.message, 503);
        throw error;
      }
      if (rendered.errors) throw new ProjectFaceError("INVALID_DESIGN", rendered.errors.join(" "), 422);
      const now = new Date().toISOString();
      const next = await store.mutate(id, (p) => {
        p.versions.push({ n: rendered.version, at: now, warnings: rendered.warnings, ...(rendered.checks?.length ? { checks: rendered.checks } : {}), note: "faces refreshed" });
        p.current = rendered.version;
        p.messages.push({ role: "assistant", text: `Refreshed ${refreshed.length > 1 ? "the faces" : "the face"} from your face pack (${sentence(refreshed)}). Nothing else changed.`, at: now, version: rendered.version });
      });
      ctx.emit(id, "render.done", { version: rendered.version, url: `/projects/${id}/renders/v${rendered.version}.png`, warnings: rendered.warnings, checks: rendered.checks ?? [], feedUrl: rendered.feed ? `/projects/${id}/renders/v${rendered.version}-feed.png` : null });
      ctx.emit(id, "project", { project: next });
      return { project: next, version: rendered.version, refreshed, skipped };
    } finally {
      slot.finish();
    }
  }

  /** Projects that hold a copy of this pack face, with whether the copy is out of date. */
  async function usage(faceId) {
    const out = [];
    for (const p of await store.list()) {
      if (!faceAssets(p, faceId).length) continue;
      const states = await faceStatus(config.dataDir, store.dirOf(p.id), p.assets.filter((a) => a.faceId === faceId));
      out.push({ id: p.id, title: p.title, stale: states.some((f) => f.state === "stale"), busy: ctx.busy(p.id) });
    }
    return out;
  }

  /** Refreshes one face in every project that uses it (only the out-of-date ones unless `all`); one project failing never stops the others. */
  async function refreshEverywhere(faceId, { all = false } = {}) {
    const results = [];
    for (const p of await usage(faceId)) {
      if (!all && !p.stale) continue;
      try {
        const done = await refresh(p.id, { only: faceId });
        results.push({ id: p.id, title: p.title, ok: true, version: done.version });
      } catch (error) {
        results.push({ id: p.id, title: p.title, ok: false, error: error.message });
      }
    }
    return { faceId, results };
  }

  // ---- try other faces ---------------------------------------------------------------------------------

  /** The face asset a design shows: the first pack face its design.html names (else the first pack face asset). */
  function currentFace(project, html) {
    const listed = faceAssets(project)
      .map((a) => ({ a, at: html.indexOf(`assets/${a.name}`) }))
      .filter((x) => x.at >= 0)
      .sort((x, y) => x.at - y.at);
    return listed[0]?.a ?? null;
  }

  const swapText = (old, made, face) =>
    [
      `Change only the face. Replace assets/${old.name} with assets/${made.name} in design.html.`,
      `The new one is a ${face.labels.expression} face (looking ${face.labels.gaze}) from the owner's face pack, already in assets/, cut out${made.sticker ? " with the same sticker outline baked in" : ""}${made.mirrored ? ", mirrored as the old one was" : ""}.`,
      made.display ? `Show it ${made.display.width}×${made.display.height} CSS px and subtract ${made.display.offset}px from its left and top, so the face sits where the old one did.` : "",
      "Keep its size, position and eye line, and everything else in the design exactly as it is.",
    ].filter(Boolean).join(" ");

  /**
   * Duplicates the design once per face and starts one face-swap turn each, grouped as a set. `body.faces` is a list of pack
   * face ids (1 to 6), or `body.count` picks that many by itself: the best faces with distinct expressions, none already used.
   */
  async function variants(id, body) {
    if (ctx.busy(id)) throw new ProjectFaceError("TURN_RUNNING", "A turn is running; try other faces after it finishes.", 409);
    const source = await store.read(id);
    if (source.preset !== "thumbnail") throw new ProjectFaceError("NOT_THUMBNAIL", "Trying other faces is for thumbnails.", 400);
    if (!source.current) throw new ProjectFaceError("NO_RENDERS", "There is no design to try other faces on yet.", 409);
    const html = await fs.readFile(path.join(store.dirOf(id), "design.html"), "utf8").catch(() => "");
    const old = (body.replace ? faceAssets(source, body.replace)[0] : null) ?? currentFace(source, html);
    if (!old) throw new ProjectFaceError("NO_FACE", "This design has no face from your face pack to swap. Add one first (Claude's use_face).", 409);

    const all = await readAllFaces(config.dataDir);
    let chosen;
    if (body.faces !== undefined) {
      const ids = body.faces;
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_VARIANTS || !ids.every(isFaceId)) throw new ProjectFaceError("BAD_FACES", `faces must be 1 to ${MAX_VARIANTS} face ids from the pack.`);
      chosen = [];
      for (const faceId of new Set(ids)) {
        const face = await readFace(config.dataDir, faceId);
        if (!face || !usable(face)) throw new ProjectFaceError("BAD_FACES", `Face ${faceId} is not in the pack or is not ready.`);
        chosen.push(face);
      }
    } else {
      const count = body.count ?? 3;
      if (!Number.isInteger(count) || count < 1 || count > MAX_VARIANTS) throw new ProjectFaceError("BAD_COUNT", `count must be 1 to ${MAX_VARIANTS}.`);
      const current = all.find((f) => f.id === old.faceId);
      chosen = pickVariantFaces(all, { count, exclude: [old.faceId], avoidExpression: current?.labels?.expression ?? null });
      if (!chosen.length) throw new ProjectFaceError("NO_FACES", "The face pack has no other usable face to try.", 409);
    }
    const title = `${source.title.replace(/ \(copy\)$/, "")} · other faces`.slice(0, 80);
    const copies = [];
    try {
      for (const face of chosen) {
        const copy = await store.duplicate(id, `${source.title.replace(/ \(copy\)$/, "")} · ${face.labels.expression} face`.slice(0, 80));
        copies.push({ copy, face });
        const dir = store.dirOf(copy.id);
        // The new face arrives treated like the old one: mirrored the same way (when allowed) and with the same sticker outline.
        let made;
        try {
          made = await takeFace(config.dataDir, dir, face.id, { mirror: old.mirrored === true, sticker: old.sticker ?? false });
        } catch {
          made = await takeFace(config.dataDir, dir, face.id, { sticker: old.sticker ?? false });
        }
        await registerFace(store, copy.id, { name: made.name, width: made.width, height: made.height, faceId: face.id, mirrored: made.mirrored, stamp: made.stamp, sticker: made.sticker, display: made.display });
        copy.made = made;
      }
    } catch (error) {
      for (const { copy } of copies) await store.remove(copy.id).catch(() => {});
      throw error;
    }
    const created = await sets.createFaceVariants({
      title,
      format: formatOf(source),
      source: id,
      brief: source.brief,
      members: copies.map(({ copy, face }) => ({
        projectId: copy.id,
        concept: { archetype: null, label: `${face.labels.expression[0].toUpperCase()}${face.labels.expression.slice(1)} face`, idea: `The same design with the owner's ${face.labels.expression} face (looking ${face.labels.gaze}).`, text: null, why: "Only the face changes.", face: face.id },
        text: swapText(old, copy.made, face),
      })),
    });
    // Each copy leaves the source's set (if it was in one) and joins this one, so the feed's neighbour rule and the compare link follow.
    await Promise.all(created.members.map((m) => store.mutate(m.projectId, (p) => void (p.conceptSet = { id: created.id, index: m.index, archetype: null, label: m.concept.label }), { touch: false })));
    return sets.startFaceVariants(created.id);
  }

  return { status, refresh, usage, refreshEverywhere, variants };
}
