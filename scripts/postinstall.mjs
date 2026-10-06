// Best-effort: on Linux, unpack the Chromium libraries headless Electron needs (no root).
// Never fails the install; the capabilities check explains what to do if this did not work.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  if (process.platform === "linux") {
    const have = spawnSync("sh", ["-c", "command -v apt-get"], { stdio: "ignore" });
    if (have.status !== 0) {
      console.log("imago: no apt-get here, skipping the Chromium libraries (see IMAGO_CHROMIUM_LIBS).");
    } else {
      const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "setup-chromium-libs.sh");
      const result = spawnSync("bash", [script], { stdio: "inherit" });
      if (result.status !== 0) console.log("imago: the Chromium libraries were not set up; run `npm run setup:libs` to retry.");
    }
  }
} catch (error) {
  console.log(`imago: skipped the Chromium libraries (${error?.message ?? error}).`);
}
process.exit(0);
