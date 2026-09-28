import type { PieAction } from './types';

export const todo: PieAction = {
  id: 'todo',
  label: 'Todo',
  icon: '✅',
  async run(ctx) {
    ctx.openTodo();
  },
};
