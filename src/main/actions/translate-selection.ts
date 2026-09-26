import { translate } from './translate';
import type { PieAction } from './types';

export const translateSelection: PieAction = {
  id: 'translate-selection',
  label: 'Translate text',
  icon: '文',
  async run(ctx) {
    const text = (await ctx.getSelectedText()).trim();
    if (!text) {
      ctx.showPopup(ctx.cursor).update('error', 'No text selected');
      return;
    }
    await translate(ctx, { prompt: text, tools: '', anchor: ctx.cursor });
  },
};
