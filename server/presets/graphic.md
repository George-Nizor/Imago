# Preset: custom graphic

A poster, social post, banner, cover or similar, made from the description. The size is fixed.

- Start from a concept, not decoration: what is the one thing a viewer should take in? Make that
  the largest, highest-contrast element.
- Hierarchy in three levels: a headline, a supporting line or two, small details. Use scale
  contrast (headline at least 3x the body size), weight contrast and space; not many colours.
- Grid and space: pick margins (about 6-8% of the short side) and align to them. Generous empty
  space looks deliberate; fill it only with intent. Group related things, separate unrelated ones.
- Colour: one dominant colour, one accent, one neutral pair for text and ground. Check contrast
  of text on its ground (aim for 4.5:1 or more). Gradients and tints stay close in hue.
- Type: at most two families, one display and one text face. Headlines tight and large, body
  text 28 px or more on a 1080 px canvas, line length under about 40 characters.
- Shapes and illustration: draw with inline SVG (geometric forms, simple icons, patterns,
  blobs) and CSS gradients. Keep it clean and flat or lightly layered; avoid clip-art, 
  glassmorphism clutter and tiny details that vanish at feed size.
- Respect the format: 9:16 keeps text out of the top and bottom 14% (app chrome); 1200x630
  link cards keep text inside the centre; banners (1600x500) read as one horizontal band.
- Use uploaded images deliberately: crop with `object-fit`, treat them with a colour overlay or
  duotone (`mix-blend-mode`) so they match the palette, and `cut_out` a subject when it should
  stand free.
