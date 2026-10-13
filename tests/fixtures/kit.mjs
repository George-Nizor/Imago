// A schema-v1 thumbnail kit with small real images, written the way Fabula writes one:
// <root>/<project>/out/thumbnail-kit/{kit.json, frames/, pictures/}.
import fs from "node:fs";
import path from "node:path";
import { makePng } from "../helpers.mjs";

// Two 96x54 JPEGs (encoded once with Electron's nativeImage).
export const JPEG_A = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA2AGADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAwQABv/EABcQAQEBAQAAAAAAAAAAAAAAAAACAwH/xAAXAQEBAQEAAAAAAAAAAAAAAAAFBAcG/8QAFxEBAQEBAAAAAAAAAAAAAAAAAwABAv/aAAwDAQACEQMRAD8A46cyzmeczTm7BO7nBSnnMs5qJzLOaBO5QUp5zNOZ5zLOaBO5QUgnMs5nnMs5j07lBSCcyzmonMs5oE7kxSnnM05nnMs5oE7lBS5OcyzmeczTm0BO7DRSnnMs5qJzLOaBO5QUgnMs5nnMs5j07kxSCcyzmeczTmgTuUFKecyzmonMs5oE7lBSnnM05nnMs5oE7lBS5OcyzmeczTm0BO7DRSnnMs5qJzLOaBO5MUgnMs5nnMs5j07lBSCcyzmeczTmgTuUFKecyzmonMs5oE7lBSCcyzmecyzmPTuTFLkpjhpjjM0RNsRHdlmOFmOMw9NlC3ZZjhZjjMgTZMd2WY4aY4zIE2UHdlmOFmOMw9NlB3ZZjhZjjMgTZQd2/9k=", "base64");
export const JPEG_B = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA2AGADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAgUABv/EABcQAAMBAAAAAAAAAAAAAAAAAAABA2H/xAAXAQEBAQEAAAAAAAAAAAAAAAAEBwUG/8QAFxEAAwEAAAAAAAAAAAAAAAAAAAIDAf/aAAwDAQACEQMRAD8AmuOBccKriFxww51KW9yU44FxwquOBccGJUI9yU4hccKrjgXHBiVCvclOOBccKrjgXHBs6hHuSnHAuOFVxwLjgydQj3JTjgXHCq44FxwYlQr3OpccC44VHHAuOEwnU3nsS3HAuOFRxwLjgydQj3JbjgXHCo44FxwYlQj3JbjgXHCq44FxGpUK9yU44FxwquOBccGTqEe5KccC4lVxwLjgxKhXudQ44FxwquOBccJglTee5KccC4lVxwLjgydQj3JTjgXHCq44FxwYlQr3JTjgXHCq44FxGJUI9iU44FxwquOBccGzqEe5KccC44VXHAuODEqFe51DkguSMYmibp0b7oXJBckYwye6FfdC5ILkjGGJuhH3QuSC5IxhiboR90LkguSMYbPdCvuhckFyRjDJ7oR90//Z", "base64");

export function kitManifest(overrides = {}) {
  return {
    kind: "instrumenta.thumbnail-kit",
    schemaVersion: 1,
    producer: { app: "fabula", version: "0.4.0" },
    createdAt: "2026-10-13T12:00:00.000Z",
    source: { project: "early-access", title: "We released the game", format: "landscape", durationSeconds: 611.3 },
    story: {
      logline: "A studio ships its first game and shows the launch week.",
      purpose: "Players who followed the development.",
      look: "Warm, handheld, a lot of desk.",
      hooks: [
        { text: "We released the game, guys.", atSeconds: 12.3, kind: "promise" },
        { text: "Ten thousand copies in a day.", atSeconds: 95, kind: "number" },
      ],
      chapters: [{ title: "The numbers", atSeconds: 95 }],
    },
    style: { colours: [{ role: "accent", hex: "#E8413C" }, { role: "text", hex: "#F4F0E6" }], fonts: { display: "Archivo", body: "Archivo" } },
    frames: [
      { file: "frames/f01.jpg", kind: "face", atSeconds: 12.4, width: 96, height: 54, face: { x: 30, y: 6, w: 30, h: 40 }, score: 0.83, signals: { eyesOpen: 0.96, smile: 0.62, yaw: -8, pitch: 3 }, tags: ["smile"], words: "we released the game guys" },
      { file: "frames/f02.jpg", kind: "face", atSeconds: 60, width: 96, height: 54, face: { x: 20, y: 6, w: 30, h: 40 }, score: 0.7, tags: ["surprise"], words: "no way | really" },
      { file: "frames/s01.jpg", kind: "screen", atSeconds: 140.2, width: 96, height: 54, tags: [], words: "this is the quest log" },
    ],
    pictures: [
      { file: "pictures/boss-billy.png", width: 64, height: 64, credit: "Ada Lens", license: "CC BY 4.0", atSeconds: 210 },
      { file: "pictures/logo.png", width: 32, height: 32, credit: null, license: null },
    ],
    ...overrides,
  };
}

/** Writes a kit under `root/<project>/out/thumbnail-kit` and returns that folder. */
export function writeKit(root, project = "early-access", manifest = kitManifest()) {
  const dir = path.join(root, project, "out", "thumbnail-kit");
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  fs.mkdirSync(path.join(dir, "pictures"), { recursive: true });
  fs.writeFileSync(path.join(dir, "kit.json"), JSON.stringify(manifest, null, 2));
  // Hostile manifests name odd paths; whatever cannot be written is simply absent.
  const put = (file, bytes) => {
    try {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), bytes);
    } catch {
      // absent
    }
  };
  for (const f of manifest.frames ?? []) if (typeof f.file === "string" && f.file.startsWith("frames/")) put(f.file, f.file.includes("f02") ? JPEG_B : JPEG_A);
  for (const [i, p] of (manifest.pictures ?? []).entries()) if (typeof p.file === "string" && p.file.startsWith("pictures/")) put(p.file, makePng(p.width, p.height, [60 + i * 80, 160, 90]));
  return dir;
}
