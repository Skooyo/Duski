import type { PieAction } from './types';

export const askText: PieAction = {
  id: 'ask-text',
  label: 'Ask about text',
  icon: '✎',
  async run(ctx) {
    const text = (await ctx.getSelectedText()).trim();
    if (!text) {
      ctx.showPopup(ctx.cursor).update('error', 'No text selected');
      return;
    }
    ctx.showAsk(ctx.cursor, { kind: 'text', text });
  },
};
