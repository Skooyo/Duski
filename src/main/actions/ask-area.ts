import type { PieAction } from './types';

export const askArea: PieAction = {
  id: 'ask-area',
  label: 'Ask about area',
  icon: '🔍',
  async run(ctx) {
    const image = await ctx.selectRegion();
    if (!image) return;
    const { x, y, width, height } = image.rect;
    ctx.showAsk({ x: x + width, y: y + height }, { kind: 'image', image }); // the Ask window deletes the PNG when it closes
  },
};
