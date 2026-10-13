import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DECOYS, SURFACES, surfaceHtml, themed, type FeedFormat, type FeedItem } from "../../../server/feed-markup.mjs";
import { decoyNeighbours, type FeedNeighbour } from "./feed-lib.js";
import "../../../server/feed.css";

export interface FeedPreviewProps {
  /** This design's render. */
  src: string;
  format: FeedFormat;
  title: string;
  channel?: string;
  /** Other thumbnails of the same shape; empty falls back to stand-ins. */
  neighbours: FeedNeighbour[];
  theme: "dark" | "light";
  /** A surface id of the format, see `surfacesFor`. */
  surface: string;
}

const FILLER = ["128K views", "2 days ago"];

/**
 * One thumbnail on one real surface (a YouTube grid, a Shorts screen, a profile grid...) among
 * neighbours, drawn at real size and scaled down to fit its container. The markup is the renderer's own
 * (server/feed-markup.mjs), every string escaped there.
 */
export function FeedPreview({ src, format, title, channel = "Your channel", neighbours, theme, surface }: FeedPreviewProps) {
  const def = SURFACES[format].find((s) => s.id === surface) ?? SURFACES[format][0]!;
  const html = useMemo(() => {
    const others: FeedItem[] = neighbours.length
      ? neighbours.map((n, i) => ({ src: n.src, title: n.title, channel, views: DECOYS[i % DECOYS.length]!.views, age: DECOYS[i % DECOYS.length]!.age, duration: format === "shorts" ? "" : DECOYS[i % DECOYS.length]!.duration }))
      : decoyNeighbours(format);
    const mine: FeedItem = { src, title: title || "Untitled video", channel, views: FILLER[0], age: FILLER[1], duration: format === "shorts" ? "" : "12:34" };
    return surfaceHtml(def.id, mine, others);
  }, [def.id, src, format, title, channel, neighbours]);

  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const o = outer.current, i = inner.current;
      if (!o || !i) return;
      const scale = Math.min(1, o.clientWidth / i.offsetWidth || 1);
      setFit({ scale, height: i.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [html]);
  // Images arriving late change the height.
  useEffect(() => {
    const i = inner.current;
    if (!i) return;
    const on = () => setFit((f) => ({ ...f, height: i.offsetHeight * f.scale }));
    i.addEventListener("load", on, true);
    return () => i.removeEventListener("load", on, true);
  }, [html]);

  return (
    <div className="feed-fit" ref={outer} style={{ height: fit.height || undefined }} aria-label={`${def.label}, ${theme}`} role="img">
      <div
        className="feed-natural"
        ref={inner}
        style={{ width: def.width, transform: `scale(${fit.scale})` }}
        // Built from escaped strings in server/feed-markup.mjs; the page's CSP forbids scripts anyway.
        dangerouslySetInnerHTML={{ __html: themed(theme, html) }}
      />
    </div>
  );
}
