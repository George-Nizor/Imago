import { join } from 'node:path';
import { createModernArtefact } from './modern.js';

const assets = join(process.cwd(), 'assets');

async function main() {
  const jobs = [
    {
      look: 'mesh-poster',
      title: 'Night Signal',
      subtitle: 'A design system for restless screens',
      kicker: 'ISSUE 12',
      accent: '#7c5cff',
      accent2: '#ff4d8d',
      outputName: 'v4_mesh_night_signal',
    },
    {
      look: 'liquid-chrome',
      title: 'VELOCITY',
      subtitle: 'Reflective type · Volume One',
      kicker: 'PREMIERE',
      accent: '#8eb6ff',
      accent2: '#ff9ec8',
      outputName: 'v4_chrome_velocity',
    },
    {
      look: 'neon-grid',
      title: 'AFTERDARK',
      subtitle: 'SYNTHWAVE SESSIONS',
      accent: '#39f3ff',
      accent2: '#ff3d9a',
      outputName: 'v4_neon_afterdark',
    },
    {
      look: 'duotone-photo',
      title: 'Summit Line',
      subtitle: 'Field notes from the ridge',
      kicker: 'PHOTO ESSAY',
      photoPath: join(assets, 'photo_landscape.jpg'),
      accent: '#1a0b3a',
      accent2: '#ff6b9d',
      outputName: 'v4_duotone_summit',
    },
    {
      look: 'glass-over-photo',
      title: 'Soft Focus',
      subtitle: 'Frosted UI over live plate',
      kicker: 'UI STUDY',
      photoPath: join(assets, 'photo_city.jpg'),
      outputName: 'v4_glass_soft_focus',
    },
    {
      look: 'depth-stack',
      title: 'PARALLAX',
      subtitle: 'Type mid-depth · Subject in front',
      photoPath: join(assets, 'photo_depth.jpg'),
      outputName: 'v4_depth_behind',
    },
    {
      look: 'magazine',
      title: 'Quiet Cities',
      subtitle: 'How empty streets remade the night economy and the people who stayed.',
      kicker: 'FRAME',
      photoPath: join(assets, 'photo_city.jpg'),
      accent: '#ff5a36',
      outputName: 'v4_magazine_quiet',
    },
    {
      look: 'brutalist',
      title: 'RAW FORM',
      subtitle: 'No ornament · Only structure',
      accent: '#ff3b30',
      outputName: 'v4_brutalist_raw',
    },
    {
      look: 'aurora-type',
      title: 'AURORA',
      subtitle: 'Type filled with the plate itself',
      accent: '#7c5cff',
      accent2: '#5ef0c8',
      outputName: 'v4_aurora_type',
    },
  ] as const;

  for (const job of jobs) {
    const res = await createModernArtefact(job as Parameters<typeof createModernArtefact>[0]);
    console.log(res.look.padEnd(18), res.outputPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
