# Preset: YouTube thumbnail

The canvas is one of three formats, named in "This project": video 16:9 (1280x720), Shorts-style
vertical covers 9:16 (720x1280) or podcast 1:1 (1280x1280). Design at exactly that canvas; the owner
exports at 3x, so use high-resolution assets and crisp vectors, and nothing that only works at 1x.

The goal is a click that the video then keeps. It is judged at about 200 px wide (a 9:16 cover
at about 120 px) in a busy feed, next to other thumbnails.

## Craft files

Detailed method is in `reference/craft/thumbnail/`. Read, with Read, before you write the HTML:

1. `reference/craft/thumbnail/index.md`, then `honesty-and-title.md`.
2. `archetypes/<id>.md` for your archetype: `reaction`, `result-reveal`, `before-after`, `versus`,
   `number`, `curiosity-gap`, `object-hero` or `story-moment`. Use the one named in the message;
   otherwise choose the best fit and say which. One idea only.
3. The file for your format: `vertical.md` (9:16) or `square.md` (1:1). 16:9 is covered by the archetype.
4. `face-finishing.md` when a person or cut-out is in the picture.
5. `judging.md` for what the feed mock-up and checks mean. `kit.md` when the message has "From the
   video".

## Core rules

- Three elements at most: one subject (a face or an object), one short text block, one background.
- Text: 1-4 words (2-4 on a vertical cover), uppercase, a heavy display face, huge. Contrast move: a
  thick stroke, a layered shadow, or a solid bar. The text must say what the title does not; never
  restate the title. No text at all is fine when the picture is the hook.
- Honesty: show only what the video delivers. Use the video's own frames and pictures and the
  owner's uploads. Stock images may set mood but never contradict the claim. No invented numbers,
  quotes, or fake interface.
- One thing is clearly biggest (the face or the object), a second reads next, the rest recedes.
  Subject on one side, text on the other, not both centred. Faces look toward the text. Crop tight
  and bleed off an edge.
- Dark or saturated, simple background, one accent that pops (the channel colours or the film's
  palette). Avoid grey, beige, busy detail, small print, logos, paragraphs, borders.
- 16:9: 48 px clear of the edges; keep the bottom-right corner (about 200x90 px) clear of text and subject
  (the duration badge). 9:16: key content inside the centre 3:4 crop and clear of the right rail,
  the bottom caption block and the top bar (see `vertical.md`). 1:1: nothing in the corners.
- After each render look at the feed mock-up first, at its smallest tile, then at the checks.
  Fix what they show, then render again.
- Offer one confident direction, not a compromise.
