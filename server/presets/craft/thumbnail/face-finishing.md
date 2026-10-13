# Finishing a face and a cut-out in CSS

There are no generative tools. What you have: the photo, `cut_out`, and CSS filters, gradients and
blend modes. Used together they lift an ordinary frame. Change in small steps and look at the render.

## Choosing and cropping the face

- Prefer a face that looks into the camera or toward where the text will sit, with eyes open and a
  clear expression. Avoid eyes looking down at a screen, mid-blink, mid-word frames with a half-open
  mouth (unless the archetype wants a shout), and heavy head tilt.
- Crop tight. The face (hairline to chin) should be 45-75% of a 16:9 canvas height, 30-45% of a 9:16
  canvas height, or about 55-65% of a 1:1 canvas. Let the head or the shoulders bleed off an edge:
  cutting the top of the head or one side is better than leaving a small figure floating.
- Place the eyes on the upper third line or a little above (about 30-38% of the canvas height).
- A kit frame is the whole head-camera picture with a `face` box in the frame's own pixels. To put
  that face at height `H` with its centre at `(cx, cy)` on the canvas, scale `s = H / face.h`, then
  an `<img>` with `width: frame.width * s` and `left: cx - (face.x + face.w/2) * s`,
  `top: cy - (face.y + face.h/2) * s`, `position:absolute; max-width:none`. Check the source is
  not blown up past about 1.5x its own pixels at 1x; the export is 3x, so a soft source shows.
- Keep `cut_out` for when the face must sit on a new background. It is slow, so call it once per
  photo. If the original background is already simple or can be darkened, skip the cut-out and use
  a full-bleed photo with a vignette.

## Using the face pack

The owner keeps a pack of their own face photos, cut out and labelled. Two tools reach it (they exist
whether or not the pack has anything in it; an empty pack says so).

- `find_faces({expression?, gesture?, gaze?, minGrade?, count?})` returns the best matches (starred
  first, hidden never) with their labels and a numbered contact sheet. Expressions: smile, laugh,
  surprise, shock, excited, thinking, sceptical, confused, intense, angry, sad, neutral (`intensity`
  1-3). Gestures include point-left, point-right, point-camera, point-up, hands-up, facepalm, thumbs-up,
  thumbs-down, arms-crossed, hand-on-chin, holding-object. `gaze` is in image terms: `left` looks
  toward the left edge.
- `use_face({id, mirror?})` puts the cut-out in `assets/` as `face-<id>.png` (or
  `face-<id>-mirrored.png`, really flipped), ready to place. Look at the result before relying on it.

When to use it: the video has no better real frame of a person, or the concept names a pack face. A real
frame from the video's own kit that fits the moment always wins over a pack face, because the thumbnail
must not promise a moment the video does not have.

How to choose:

1. Ask for the expression that fits the idea, and the gaze that fits the layout: the face looks toward the
   text, so for text on the right ask for `gaze: right` (or `camera`), for text on the left `gaze: left`.
2. If the face looks the wrong way, mirror it (`mirror: true`) rather than moving the text, unless
   `mirrorSafe` is false for it (the owner or a text or logo in the shot rules it out); then pick another
   face, or move the text to the side the eyes point to.
3. Respect the grade. Export is 3x, so a face filling half the canvas needs about 1000 px of face in the
   photo. `4k`: use it at any size. `hd`: keep it to about 40% of the canvas height or less, or accept a
   little softness. `soft`: only small, as a secondary face or under a heavy grade; prefer another face.
   Ask with `minGrade: "hd"` when the face will be big.
4. Several concepts in a set use different faces. Do not reuse the face a sibling has.

The same honesty rules apply as for any picture: a face from the pack is the owner, not the person in
a moment of the video, so do not pair it with a caption or scene that claims it is that moment.

## Lifting the face

Apply these on the face image itself, then judge:

```css
.face { filter: brightness(1.08) contrast(1.12) saturate(1.12); }
```

- Dull or flat webcam light: brightness 1.08-1.18, contrast 1.1-1.25. Orange skin: saturation 1.0
  (not more). Pale or grey: saturation 1.1-1.2. Keep skin tones believable; never green or blue.
- Dark corners and an overexposed forehead are fixed by a soft radial gradient overlay
  (`radial-gradient(ellipse at 50% 40%, transparent 40%, rgba(0,0,0,.35))`) and by not pushing
  brightness past 1.2.

## Rim light and separation

A thin bright edge makes the cut-out leap off the background. Stack `drop-shadow()` filters on the
cut-out (these follow the alpha edge):

```css
.face {
  filter:
    brightness(1.08) contrast(1.12) saturate(1.1)
    drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff)          /* tight white keyline */
    drop-shadow(-14px 0 16px var(--accent))                       /* accent rim on the side toward the text */
    drop-shadow(0 22px 28px rgba(0,0,0,.55));                     /* grounding shadow */
}
```

- Keyline 4-10 px at 1280 wide (more stacked shadows widen it). Rim light uses the accent from the
  brief or the film's palette, on the side where the "light" comes from, usually the text side.
- A coloured glow behind the head (a `radial-gradient` of the accent, 40-60% opacity) beats a flat
  background and costs nothing.

## Depth: separate subject from background

- Darken or blur what is behind: `filter: blur(6px) brightness(.55) saturate(1.1)`, scaled up 1.08
  so blurred edges do not show. A scene should be recognisable, not sharp.
- Or colour it: a dark gradient in the accent, with a faint texture.
- Add a vignette over the background only (not the face): a `radial-gradient` from transparent to
  `rgba(0,0,0,.5)` at the corners.
- Keep the subject the brightest and sharpest thing in the frame.

## Eye-line and direction

The face looks toward the text, or toward the thing it reacts to (the object, the result). Flip a
face with `transform: scaleX(-1)` to fix direction. Never flip when there is readable text, a
logo or a distinctive asymmetric feature (a parting, a scar) the viewer knows. Place the text on the
side the eyes point to, at the same height as the eyes or just below.

## Things that look cheap

- A white outline thicker than 12 px, or a different outline colour on each side.
- Over-saturation that turns skin orange or red.
- A cut-out with leftover background fringe: a dark blur behind it or 2 px of keyline hides it.
- Several faces of equal size. One face leads; others are smaller and secondary.
