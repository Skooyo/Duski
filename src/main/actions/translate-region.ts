import { nativeImage } from 'electron';
import fs from 'node:fs';
import { getConfig } from '../config';
import { translate } from './translate';
import type { PieAction } from './types';

// The API scales larger images down; Claude's boxes would then be in the scaled size. Scale first, so they match.
const MAX_SIDE = 1568;

export const translateRegion: PieAction = {
  id: 'translate-region',
  label: 'Translate area',
  icon: '⛶',
  async run(ctx) {
    const region = await ctx.selectRegion();
    if (!region) return;
    try {
      let img = nativeImage.createFromPath(region.path);
      const size = img.getSize();
      const k = MAX_SIDE / Math.max(size.width, size.height);
      if (k < 1) {
        img = img.resize({ width: Math.round(size.width * k), height: Math.round(size.height * k), quality: 'best' });
        fs.writeFileSync(region.path, img.toPNG());
      }
      const { width, height } = img.getSize();
      const { x, y, width: w, height: h } = region.rect;
      await translate(ctx, {
        prompt: `Read the image file ${region.path}. It is ${width}x${height} pixels. Translate the text in it.`,
        tools: 'Read',
        anchor: { x: x + w, y: y + h }, // popup at the bottom-right corner of the box
        model: getConfig().models.translateArea,
        lens: { rect: region.rect, dataUrl: img.toDataURL(), width, height },
      });
    } finally {
      fs.rmSync(region.path, { force: true });
    }
  },
};
