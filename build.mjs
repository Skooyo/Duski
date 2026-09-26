import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
const renderers = fs.existsSync('src/renderer')
  ? fs.readdirSync('src/renderer').filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((f) => `src/renderer/${f}`)
  : [];

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron', '@nut-tree-fork/nut-js'] }),
  build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  renderers.length && build({ ...common, entryPoints: renderers, outdir: 'dist/renderer', platform: 'browser', format: 'iife' }),
]);
