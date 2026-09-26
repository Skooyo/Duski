import { chat } from './chat';
import { translateRegion } from './translate-region';
import { translateSelection } from './translate-selection';
import type { PieAction } from './types';

/** Pie order = number keys 1..8. Add a feature: create one file in this folder and add it here. */
export const actions: PieAction[] = [chat, translateSelection, translateRegion];
