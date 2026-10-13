# Vertical covers: YouTube Shorts, Instagram Reels, TikTok

One 9:16 design (720x1280 canvas, exported at 3x for Shorts, and at 1080x1920 for Reels and TikTok)
that works on three platforms. It is shown in two ways, and both must work:

1. **In the grid or shelf**, as a small tile. On Instagram and TikTok profile grids this is a
   **3:4 centre crop** of the 9:16 image: the full width and the middle 75% of the height.
2. **Full screen**, as the video's opening frame or cover, under the platform's overlay.

## The numbers (on the 720x1280 canvas)

| Zone | Range | Why |
| --- | --- | --- |
| 3:4 centre crop | y 160 to 1120, full width | The profile grids cut 160 px from the top and bottom |
| Top bar | y 0 to about 190 | Status bar, search, account/back controls |
| Right action rail | x about 590 to 720 | Like, comment, share, audio; about 18% of the width |
| Bottom caption block | y about 960 to 1280 | Account name, caption, hashtags, progress: about the bottom 25% |
| TikTok grid view count | bottom-left of the 3:4 crop, about x 0-220, y 1040-1120 | Drawn over the cover |
| Side margin | 48 px each side | Fit and breathing room |

So the **key zone** is x 48 to 590, y 190 to 960. Put the face (eyes especially), all text and the
one thing the viewer must see inside it. Backgrounds, colour, the lower body and anything
decorative may run to every edge. Nothing essential in the right rail, the bottom 25% or the
top 15%.

These are conservative figures gathered from third-party measurements (below), because the platforms
publish no official pixel boxes for covers, and they change with app versions and devices. The
`layout.safe` check in the render result applies the same idea; if its message disagrees with a
number here, follow the check's message.

## Layout

- One idea, vertical: subject in the upper-middle (eyes at 28-36% of the height, about 360-460 px), text
  below the face or over the lower half of the key zone, a bold ground.
- **2-4 words**, never more. Type bigger than on 16:9: 150-260 px for one or two words, 110-170 px
  for three or four. Text height is judged at the profile grid, where the tile is about 120 px
  wide, so a letter under about 80 px tall at 720 wide is lost.
- Stack words on two or three lines, left-aligned or centred inside the key zone. A line must not run past
  x 590.
- Subject: 45-70% of the key zone's height for a face. A tall object or full-figure subject fits
  too; leave the caption block's 25% for its feet or its base.
- Contrast is judged in a tiny grid tile and on a busy full screen. Use a dark or saturated ground
  and a bright subject, and a text stroke or panel.
- The grid tile shows the cover only; nobody sees the rest of the frame. Make the 3:4 crop a
  complete composition on its own.

## Per platform

- **YouTube Shorts:** the cover sits in the Shorts shelf, search and the channel's Shorts tab. YouTube's help page
  has said a Short's thumbnail is a frame you choose; reports from 2026 describe custom thumbnail
  upload being rolled out to some channels, in Studio. Either way the designed cover may be used as an
  opening frame or an uploaded thumbnail. Recommended size 2160x3840, 9:16, at least 640 px tall.
- **Instagram Reels:** the cover shows in the profile grid (3:4 centre crop since the 2025 grid
  change) and the Reels tab (full 9:16). A cover is 1080x1920. Keep the centre 3:4 complete.
- **TikTok:** the cover shows in the profile grid (3:4 centre crop) with the view count over the
  bottom-left, and on search/for-you tiles. 1080x1920.

If the brief lists platforms, design for those; the key zone above is safe for all three, so there is no
need for a version per platform.

## Sources (accessed 2026-10-13)

None of these is an official spec for the exact pixel boxes; they agree on the 3:4 crop and disagree
on the overlay sizes, so the numbers above are the conservative end.

- Instagram grid is 3:4 and a 1080x1920 cover loses 240 px top and bottom of its 1080-wide size
  (that is 160 px on the 720 canvas): Hopper HQ, "Instagram Reel size in 2026: Dimensions, aspect ratio,
  and safe zones" (https://www.hopperhq.com/blog/instagram-reel-size/); Planoly, "A complete guide to
  Instagram's new vertical grid" (https://planoly.com/blog/guide-to-instagrams-new-vertical-grid);
  Oktopost, "Instagram grid size guide for 2026" (https://www.oktopost.com/blog/instagram-grid-size-guide/).
  Instagram's own help page "Reel size & aspect ratios on Instagram"
  (https://help.instagram.com/1038071743007909) gives a recommended cover of 420x654 (about 1:1.55)
  and does not describe the grid crop.
- TikTok overlays (right rail about 22% of the width, caption zone about the bottom 25-37%, top about
  13%): Adkit, "TikTok Ad Safe Zones" (https://adkit.so/tools/safe-zones/tiktok), measured from ad
  previews, March 2026; Posterly safe-zone checker (https://www.poster.ly/tools/safe-zone-checker);
  Reap, "YouTube Shorts, Reels and TikTok safe zones" (https://reap.video/blog/short-form-video-safe-zones).
- YouTube Shorts overlays (right rail 15-20% of the width, bottom block about 20-25%, top about
  8-13%): Adkit, "YouTube Shorts Ad Safe Zones" (https://adkit.so/tools/safe-zones/youtube); Kapwing,
  "YouTube Shorts safe zones" (https://www.kapwing.com/video-editor/youtube-shorts/safe-zone).
- Shorts thumbnails and size: YouTube Help, "Add custom thumbnails on YouTube"
  (https://support.google.com/youtube/answer/72431); AlternativeTo, "YouTube introduces custom
  thumbnails for Shorts" (https://alternativeto.net/news/2026/7/youtube-introduces-custom-thumbnails-for-shorts-and-ask-studio-ai-thumbnail-generation/);
  Reap, "How to add a custom thumbnail to YouTube Shorts in 2026" (https://reap.video/blog/how-to-add-custom-thumbnail-youtube-shorts).
