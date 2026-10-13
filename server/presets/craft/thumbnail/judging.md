# Judging a render: the feed mock-up and the checks

After each `render` you receive, in this order: your design, a **feed mock-up** image, and a text
block `{version, warnings, checks}`. The mock-up shows your design at the sizes it will be seen,
next to other thumbnails, in dark and light. The checks are measurements. They never block a
render; they tell you where to look. You have a small number of renders: use the mock-up to decide
what to change, change several things at once, render again.

## Reading the mock-up

Do these, in order, at the smallest size first:

1. **Squint test.** Look at the smallest tile. Can you tell in one second what it is: a face, an
   object, a result? Is there one clear bright shape on a calmer ground? If it dissolves into
   texture, simplify.
2. **First thing you see.** It should be the face (or the object/number the archetype is about),
   then the text. If something else wins (a bright corner, a logo, a stock picture), dim it.
3. **Neighbours.** Does it stand out from the thumbnails around it, or blend in? If every neighbour
   is dark and busy, a clean bright ground wins; if they are bright, go darker or use a different
   hue. Do not copy their look.
4. **Words.** Can you read the text in the smallest tile? Is it 1-4 words (2-4 for vertical)? Does it
   say something the title does not?
5. **Overlays.** On vertical full-screen mock-ups: is the face or any text under the rail, the
   caption block or the top bar? In the profile-grid tile: is the 3:4 crop a complete picture?
6. **Honesty.** Would the video's viewer say "yes, that's what this was"? If not, change it.

Stop when it passes all six. Say what you see in the smallest tile in your reply if you stopped
because it was strong; say what is still weak if you ran out of renders.

## What to do about each check

| Check id | What it means | What to do |
| --- | --- | --- |
| `text.words` | More visible words than the format wants (5, or 4 vertical) | Cut to the one word that carries the meaning, then the second only if it changes it |
| `text.repeatsTitle` | The text mostly restates the title | Rewrite it to say what the title does not: the verdict, the stake, the question |
| `text.smallest` | The smallest text is too small at the smallest surface | Make it larger, or delete it. Small print has no place on a thumbnail |
| `text.contrast` | Text is weak against what is behind it | Add a dark stroke or shadow, a panel, or darken/blur the area behind. Or change the text colour to white or a bright accent |
| `layout.badge` | Text or the subject is in the duration-badge corner (16:9) | Move it out of the bottom-right; shift the subject or the text left or up |
| `layout.safe` | Text or the subject is outside the 3:4 centre crop or under an overlay (9:16) | Move into the key zone in `vertical.md`; shrink or lift the subject |
| `subject.size` | The face is small | Enlarge and crop tighter, bleed off an edge. A small face earns nothing |
| `image.contrast` | Information: the global contrast at feed size, with the band it should be in | If outside the band, darken the ground or brighten the subject; add a vignette |
| `image.colourfulness` | Information: how colourful at feed size | Low and not deliberate: add an accent. Very high: calm the ground so the subject wins |
| `feed.distinct` | Information: low means it blends in with the neighbours | Change the ground's hue or lightness, or the layout. Do not add elements |

`ok` needs no action; `warn` needs a change or a reason you can state; `info` is a hint. Do not
chase a number at the cost of the idea: an `info` check never outranks the squint test.

Warnings (the other list) come from the design validator: fix every error and every warning about
fonts or assets.
