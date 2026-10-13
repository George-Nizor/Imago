# Using the thumbnail kit ("From the video")

When the video was made in Fabula, the first message may include a **From the video** section:
material the film itself provides. Use it before anything else. It exists so that the thumbnail
shows what the video shows and sounds like the video.

What it can hold (each appears only if there is something to say):

- **Frames** under `assets/kit-f01.jpg ...` (face frames) and `assets/kit-s01.jpg ...` (screen
  frames), each with a time, tags, signals, the words being said at that moment, and for faces the
  face box in the frame's own pixels. Read the images; do not choose by the list alone.
- **Hooks**: lines the speaker actually said, with a kind (`promise`, `claim`, `number`, `question`,
  `quote`). A **logline**, **purpose**, **look** and **chapters** describe the film.
- **Pictures** the film itself shows (`assets/kit-<name>.png`), sometimes with a credit.
- **Palette** and **fonts** from the film's own design.
- A **contact sheet** image (when it is named): all frames on one page, labelled, so you see the
  whole set at once. Read it first.

## Choosing a face frame

1. Look at the contact sheet or at several frames. Prefer a frame with a real expression for the
   archetype: `surprise`, `laugh`, `smile` or `intense` for `reaction`; `intense` or `speaking` for
   claims; `pointing` for `curiosity-gap`; `neutral` only for `story-moment` or `object-hero`.
2. Use the signals: `eyesOpen` near 1, `mouthOpen` high only when the archetype wants a shout,
   `yaw` within about +-20 degrees (face to camera; toward the text is fine), `pitch` near 0 (a face
   looking down at a screen reads as bored), `sharpness` high, `exposure` mid (about 0.4-0.7),
   `faceHeight` large (the face has pixels to spare for a big crop).
3. Check the words on that frame: do they fit the claim? A frame with a laugh while the speaker
   says something sad confuses.
4. Cut the face out with `cut_out` only if it needs a new background. Otherwise crop the frame.
5. If no frame has a usable expression, use a `story-moment` or `object-hero` with a screen frame,
   and say so.

## Using the rest

- **Palette:** use the film's accent colours for the ground, the rim light and the text. Keep
  the thumbnail's contrast: if the film's accent is dark, put a lighter tint behind the subject.
- **Display font:** if the kit names a display font that is in the font list, use it for the
  text so the thumbnail and the film match (Archivo is Fabula's). Otherwise take the closest heavy
  face you have.
- **Hooks:** the image text can be 1-4 words taken straight from a hook (`promise`, `claim` and
  `question` make good tease; `number` hooks suit the `number` archetype). A hook may be shortened
  but not changed in meaning, and must still not restate the title.
- **Pictures:** use for `object-hero`, `result-reveal`, `before-after` and `versus`, because the
  video itself shows them. Respect the credit if present (it is kept for export; do not draw it).
- **Screen frames:** crop to the one region that matters and enlarge it. Never leave tiny UI.
- **Chapters and logline:** they tell what the video delivers; use them for the honesty check.
- Frames are at the film's time; the thumbnail may combine a frame from one moment with a
  picture from another only if both are in the film.

If the kit is absent, work from the brief and the uploads exactly as before.
