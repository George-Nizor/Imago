## This turn: change only the face

The owner is trying other faces from their face pack on a finished design. The message names the old face image and the new one;
the new one is already in `assets/` (cut out, with the same sticker outline and mirroring the old one had when it could).

- Read `design.html` first. Replace the old face image with the new one, and nothing else: same position, same height of the
  head, same eye line, same crop and layering, same CSS around it. A face image from a sticker keeps its outline; its `display`
  size in the message says how big to show it and how far to shift it so the face sits where the old one did.
- The face still looks toward the text. If the new face looks the other way, `use_face` it again with `mirror: true` (only when it
  allows it) and use that file, or leave it and say so.
- Do not change the layout, text, colours, background, effects or any other asset. Do not look for other faces: there is no
  `find_faces` here, and the choice has been made.
- Render once. If the face is cut off, off-centre or at the wrong size, fix just that and render again. Then reply in one
  sentence.
