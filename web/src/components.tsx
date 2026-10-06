import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Capabilities } from "./api/types.js";
import { Icon } from "./brand/Icon.js";
import type { ImagoIconName } from "./brand/imago-icons.js";
import { navigate, useTheme } from "./lib.js";

export function Header({ trail }: { trail?: string }) {
  const [theme, toggle] = useTheme();
  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        <img src="/brand/imago.svg" alt="" width={34} height={34} />
        <span className="display brand-name">Imago</span>
      </a>
      {trail && <span className="trail">{trail}</span>}
      <button
        type="button"
        className="icon-btn"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={28} />
      </button>
    </header>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label ?? "Working"} />;
}

export function Btn({
  icon,
  children,
  variant = "ghost",
  size = 20,
  ...rest
}: {
  icon?: ImagoIconName;
  variant?: "primary" | "ghost" | "danger";
  size?: number;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant} ${rest.className ?? ""}`}>
      {icon && <Icon name={icon} size={size} />}
      {children}
    </button>
  );
}

/** Why Claude can't be used yet, with the command that fixes it. */
export function CapabilityPanel({
  caps,
  checking,
  onRecheck,
}: {
  caps: Capabilities;
  checking: boolean;
  onRecheck: () => void;
}) {
  const bad = caps.claude.state !== "ready" ? caps.claude : caps.renderer;
  const title =
    caps.claude.state === "missing"
      ? "Claude Code isn't installed yet"
      : caps.claude.state === "signed-out"
        ? "Claude Code needs you to sign in"
        : "The image renderer isn't ready";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bad.fix);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the command is visible and selectable anyway */
    }
  };
  return (
    <section className="notice" aria-labelledby="cap-title">
      <Icon name="alert" size={40} className="notice-icon" />
      <div className="notice-body">
        <h2 id="cap-title" className="display">{title}</h2>
        <p>{bad.reason} Imago designs through your own Claude subscription, so this has to work first. Everything else is waiting on it.</p>
        {bad.fix && (
          <div className="cmd">
            <code>{bad.fix}</code>
            <Btn icon="copy" size={18} onClick={copy} aria-label="Copy the command">
              {copied ? "Copied" : "Copy"}
            </Btn>
          </div>
        )}
        <Btn icon="refresh" variant="primary" onClick={onRecheck} disabled={checking}>
          {checking ? "Checking…" : "Recheck"}
        </Btn>
      </div>
    </section>
  );
}

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 40 * 1024 * 1024;

/** Drag, drop, click or paste images. Reports a plain sentence for anything it refuses. */
export function Dropzone({
  files,
  onChange,
  multiple,
  title,
  hint,
  busy,
  status,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  title: string;
  hint: string;
  busy?: boolean;
  /** Per-file note shown on its thumbnail, e.g. "Cutting out…". */
  status?: Record<string, string>;
}) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const add = useCallback(
    (incoming: File[]) => {
      const ok: File[] = [];
      setProblem("");
      for (const f of incoming) {
        if (!ACCEPT.includes(f.type)) setProblem(`${f.name || "That file"} isn't a PNG, JPEG or WebP image.`);
        else if (f.size > MAX_BYTES) setProblem(`${f.name || "That image"} is over the 40 MB limit.`);
        else ok.push(f);
      }
      if (ok.length) onChange(multiple ? [...files, ...ok] : ok.slice(0, 1));
    },
    [files, multiple, onChange],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!pasted.length || busy) return;
      e.preventDefault();
      add(pasted);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [add, busy]);

  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  return (
    <div>
      <div
        className={`drop ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) add([...e.dataTransfer.files]);
        }}
      >
        <Icon name="upload" size={40} />
        <div>
          <strong>{title}</strong>
          <span className="hint">{hint}</span>
        </div>
        <Btn disabled={busy} onClick={() => input.current?.click()}>
          Choose {multiple ? "files" : "a file"}
        </Btn>
        <input
          ref={input}
          type="file"
          hidden
          accept={ACCEPT.join(",")}
          multiple={multiple}
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {files.length > 0 && (
        <ul className="thumbs">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <img src={urls[i]} alt={f.name} />
              {status?.[f.name] && <span className="thumb-status">{status[f.name]}</span>}
              {!busy && (
                <button
                  type="button"
                  className="thumb-x"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
