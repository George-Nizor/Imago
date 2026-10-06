// Runs the server and Vite together; either one exiting (or Ctrl-C) takes both down.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = process.env.PORT || "49321";
const env = { ...process.env, PORT: port, HOST: "127.0.0.1", IMAGO_ALLOWED_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173" };
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

const children = [
  spawn(process.execPath, ["server/index.mjs"], { cwd: root, env, stdio: "inherit" }),
  spawn(process.execPath, [vite, "--config", "web/vite.config.ts"], { cwd: root, env, stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
for (const c of children) c.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
