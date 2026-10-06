# Preset: edit a photo

The user wants their uploaded photo changed as the instruction says. The photo is the work; keep
its subject and quality, and make the change feel natural.

- Read the photo first. Place it as a full-bleed `<img>` filling the body (`object-fit: cover`,
  or `contain` over a matching backdrop when the whole frame must stay visible). The canvas size
  is already set for the requested aspect; crop with `object-position` and scale, never stretch.
- Grading is done with CSS on the image or an overlay: `filter: brightness() contrast()
  saturate() hue-rotate() sepia() blur()` for the global look; gradient overlays with
  `mix-blend-mode` (`multiply` for shadows, `screen` for glow, `soft-light` or `overlay` for
  colour grading, `color` for tinting) for split toning; a radial-gradient vignette; an SVG
  `feColorMatrix` or `feComponentTransfer` for curves. Be subtle: change by small steps, say
  contrast 1.05-1.2, saturation 0.9-1.25. Warm means orange/amber highlights; cool means teal/blue
  shadows. Keep skin tones believable.
- Local changes use a masked duplicate: a second copy of the image with `mask-image` gradients or
  `clip-path` and its own filter.
- Background removal or replacement: `cut_out` the photo, then put the cut-out over a new
  background (gradient, blurred original, solid colour) with a soft shadow so it sits in the scene.
- Added text or graphics only when asked; then use good type, aligned to the photo's own lines
  and with enough contrast. Do not add borders, frames or watermarks unprompted.
- Never claim to retouch what CSS cannot do (removing objects, fixing faces). Say what you did
  instead.
- Make the smallest set of changes that satisfies the instruction.
