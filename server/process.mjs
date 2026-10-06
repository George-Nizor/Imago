import { spawn } from "node:child_process";

const MAX_TAIL = 4_000;

export class SpawnError extends Error {
  constructor(binary, cause) {
    super(`could not start '${binary}': ${cause?.message ?? cause}`);
    this.code = cause?.code;
    this.cause = cause;
  }
}

/**
 * Runs a child with its own process group, so a timeout or cancel reaches whatever it started.
 * stdout is delivered line by line as it arrives (stream-json is parsed incrementally).
 * Resolves with how it ended; rejects only when the program cannot be started.
 */
export function runProcess({
  binary,
  args = [],
  cwd,
  stdin = "",
  env = process.env,
  timeoutMs = 600_000,
  killGraceMs = 2_000,
  signal,
  onStdoutLine,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return resolve({ code: null, signal: null, timedOut: false, aborted: true, stderr: "" });
    const detached = process.platform !== "win32";
    const child = spawn(binary, args, { cwd, env, detached, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let pending = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let killTimer;

    const stop = (sig) => {
      try {
        if (detached && child.pid !== undefined) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        // Already gone.
      }
    };
    const terminate = () => {
      stop("SIGTERM");
      killTimer ??= setTimeout(() => stop("SIGKILL"), killGraceMs);
      killTimer.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const emitLine = (line) => {
      if (!line || !onStdoutLine) return;
      try {
        onStdoutLine(line);
      } catch {
        // A consumer bug must not kill the stream.
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      let nl;
      while ((nl = pending.indexOf("\n")) >= 0) {
        emitLine(pending.slice(0, nl).replace(/\r$/, ""));
        pending = pending.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-MAX_TAIL);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new SpawnError(binary, error));
    });
    child.on("close", (code, sig) => {
      if (settled) return;
      settled = true;
      cleanup();
      emitLine(pending.replace(/\r$/, ""));
      resolve({ code, signal: sig, timedOut, aborted, stderr: stderr.trim() });
    });
    // The program may close stdin early; the exit status tells the real story.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin, "utf8");
  });
}

/** Short command whose whole stdout is wanted. */
export async function capture(binary, args, { timeoutMs = 8_000, env, cwd } = {}) {
  let out = "";
  const result = await runProcess({
    binary,
    args,
    cwd,
    env,
    timeoutMs,
    onStdoutLine: (line) => {
      out += `${line}\n`;
    },
  });
  return { ...result, stdout: out };
}
