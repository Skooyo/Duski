import type { PieAction } from './types';

export const chat: PieAction = {
  id: 'chat',
  label: 'Chat',
  icon: '💬',
  async run(ctx) {
    ctx.openChat();
  },
};
