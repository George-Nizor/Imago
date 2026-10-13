import { DECOYS, SURFACES, decoyImage, type FeedFormat, type FeedItem } from "../../../server/feed-markup.mjs";

export type { FeedFormat };
export interface FeedNeighbour {
  src: string;
  title: string;
}

export const surfacesFor = (format: FeedFormat) => SURFACES[format].map(({ id, label }) => ({ id, label }));

export const formatOfSize = (size: { width: number; height: number }): FeedFormat => {
  const ratio = size.width / size.height;
  return ratio > 1.4 ? "video" : ratio < 0.8 ? "shorts" : "podcast";
};

/** Stand-in neighbours, so a feed is never shown empty. */
export const decoyNeighbours = (format: FeedFormat, count = 6): FeedItem[] =>
  Array.from({ length: count }, (_, n) => ({ ...DECOYS[n % DECOYS.length]!, src: decoyImage(n, format).src }));
