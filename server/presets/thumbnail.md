# Preset: YouTube thumbnail

The project canvas is one of three formats, named in "This project": video 16:9 (1280x720),
Shorts 9:16 (720x1280) or podcast 1:1 (1280x1280). Design at exactly that canvas; the owner
exports it at 3x (3840x2160, 2160x3840, 3840x3840, YouTube's recommended sizes), so use
high-resolution assets and crisp vectors, and no tiny details that only work at 1x.
A Shorts thumbnail is vertical: stack subject and text top to bottom, keep the face and the text
in the centred safe area (about 48 px from the sides, and clear of the top and bottom 15%
where the Shorts UI sits). A podcast thumbnail is square: one centred subject, 1-3 words,
nothing in the corners. The layout rules below (side by side, bottom-right badge) are for 16:9
only; adapt them to the other two formats.

The goal is a click. It is judged at about 200 px wide on a busy feed, so everything must survive
being tiny.

- Three elements at most: one subject (a face or object), one short text block, one background.
  Anything else must earn its place.
- Text: 1-4 words, uppercase, a heavy condensed face (Anton, Bebas Neue, Archivo Black) at 120-220
  px, tight line height. Give it a contrast move: a thick `-webkit-text-stroke` or layered
  `text-shadow` in a dark colour, or a solid colour bar behind it. Never light text on a mid-tone
  without one. If the brief gives a long title, distil it to the hook; do not repeat the title.
- Hierarchy: one thing is clearly biggest (usually the subject or the key word), a second reads
  next, the rest recedes. Give the eye a path, left to right or top to bottom.
- Contrast and colour: a dark or saturated, simple background (gradient, vignette, a few
  large shapes), one accent colour that pops, a bright rim or glow behind the subject. Use the
  channel colours from the brief when given. Avoid grey, beige and busy detail.
- Subject: if a photo is uploaded, `cut_out` it, enlarge it to fill 45-60% of the height, bleed it
  off an edge, and add a 6-12 px light outline (several stacked `drop-shadow()` filters or a
  white cut-out copy behind). Faces and eyes in the upper two thirds, looking toward the text.
- Layout: subject on one side, text on the other, not both centred. Keep 48 px clear of every
  edge and keep the bottom-right 280x120 px empty (the video duration badge sits there).
- Emotion or curiosity beats information. Exaggerate: bigger, brighter, closer.
- No small print, logos, paragraphs, borders or drop-shadow boxes. If it needs reading closely it
  is wrong.
- Offer one confident direction, not a compromise between several.
