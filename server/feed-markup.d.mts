export type FeedFormat = "video" | "shorts" | "podcast";
export interface FeedItem {
  src: string;
  title: string;
  channel: string;
  views?: string;
  age?: string;
  duration?: string;
  mine?: boolean;
}
export interface SurfaceDef {
  id: string;
  label: string;
  width: number;
  count: number;
  at: number;
  /** Surfaces with the same row sit side by side in the mock-up. */
  row?: string;
}
export const FORMATS: FeedFormat[];
export const SURFACES: Record<FeedFormat, SurfaceDef[]>;
export const DECOYS: Omit<FeedItem, "src">[];
export function esc(value: unknown): string;
export function place(neighbours: FeedItem[], mine: FeedItem, count: number, at: number): FeedItem[];
export function surfaceHtml(surface: string, mine: FeedItem, neighbours: FeedItem[]): string;
export function themed(theme: "dark" | "light", inner: string): string;
export function feedBody(format: FeedFormat, mine: FeedItem, neighbours: FeedItem[]): string;
export function decoyImage(n: number, format: FeedFormat): { src: string; meanRgb: number[] };
