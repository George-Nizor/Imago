import { useMemo } from "react";
import { type ImagoIconHue, type ImagoIconName, renderImagoIcon } from "./imago-icons.js";

/**
 * An Imago icon in the Instrumenta v2 style (adapted from Discere's Icon.tsx). Decorative unless
 * `label` is given. Size picks the level of detail (16, 24, or 32 and up), as the brand library does.
 */
export function Icon({
  name,
  size = 24,
  hue,
  label,
  className = "",
}: {
  name: ImagoIconName;
  size?: number;
  hue?: ImagoIconHue;
  label?: string;
  className?: string;
}) {
  const markup = useMemo(
    () => renderImagoIcon(name, { size, ...(hue ? { hue } : {}), ...(label ? { label } : {}) }),
    [name, size, hue, label],
  );
  return (
    <span
      className={`ii-icon ${className}`}
      style={{ width: size, height: size }}
      // The markup is generated from the fixed glyph table, never from user input.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
