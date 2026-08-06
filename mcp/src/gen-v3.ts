import { createVideoArtefact } from './artefacts.js';

async function main() {
  const jobs = [
    {
      kind: 'intro-card',
      title: 'Ashfall',
      subtitle: 'A Fable Original Series',
      mood: 'ember',
      font: 'cinzel',
      outputName: 'v3_intro_ashfall',
    },
    {
      kind: 'intro-card',
      title: 'Northern Light',
      subtitle: 'Episode One',
      mood: 'deep-teal',
      font: 'cinzel',
      material: 'foil-silver',
      outputName: 'v3_intro_northern',
    },
    {
      kind: 'chapter-card',
      title: 'The Crossing',
      subtitle: 'Chapter III',
      mood: 'paper',
      font: 'playfair',
      outputName: 'v3_chapter_crossing',
    },
    {
      kind: 'quote-card',
      title: 'We do not remember days, we remember moments.',
      subtitle: 'Cesare Pavese',
      mood: 'noir',
      outputName: 'v3_quote_pavese',
    },
    {
      kind: 'end-slate',
      title: 'Thanks for Watching',
      subtitle: 'New episodes every Friday',
      mood: 'deep-teal',
      font: 'oswald',
      outputName: 'v3_end_slate',
    },
    {
      kind: 'lower-third',
      title: 'Mara Voss',
      subtitle: 'Lead Environment Artist',
      font: 'bebas',
      outputName: 'v3_lower_third_mara',
    },
    {
      kind: 'intro-card',
      title: 'Ember Days',
      subtitle: 'A Short Film',
      mood: 'ember',
      font: 'playfair',
      blendMode: 'image-clip',
      transparent: false,
      outputName: 'v3_intro_clip',
    },
  ] as const;

  for (const job of jobs) {
    const res = await createVideoArtefact(job as Parameters<typeof createVideoArtefact>[0]);
    console.log(res.outputPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
