import fs from "node:fs/promises";

// Windows refuses a rename while another process (a virus scanner, the search indexer, a render
// reading the file) has the target or the source open, with EPERM, EACCES or EBUSY. It clears in
// moments, so a rename is tried a few more times before the error is real. Elsewhere it is a rename.
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

export async function rename(from, to, { attempts = 6, delayMs = 50, rename: move = fs.rename, platform = process.platform } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await move(from, to);
    } catch (error) {
      if (platform !== "win32" || attempt >= attempts || !TRANSIENT.has(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
