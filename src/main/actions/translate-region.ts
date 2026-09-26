import fs from 'node:fs';
import { translate } from './translate';
import type { PieAction } from './types';

export const translateRegion: PieAction = {
  id: 'translate-region',
  label: 'Translate area',
  icon: '⛶',
  async run(ctx) {
    const region = await ctx.selectRegion();
    if (!region) return;
    try {
      const { x, y, width, height } = region.rect;
      await translate(ctx, {
        prompt: `Read the image file ${region.path} and translate all text in it.`,
        tools: 'Read',
        anchor: { x: x + width, y: y + height }, // popup at the bottom-right corner of the box
      });
    } finally {
      fs.rmSync(region.path, { force: true });
    }
  },
};
