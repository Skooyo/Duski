import type { ClaudeRun, RunOptions } from '../claude';
import type { PopupHandle } from '../popup';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface ActionContext {
  /** Screen point (DIP) of the cursor when the hotkey was pressed. */
  cursor: Point;
  /** Returns "" when nothing is selected. */
  getSelectedText(): Promise<string>;
  runClaude(o: RunOptions): ClaudeRun;
  showPopup(anchor: Point): PopupHandle;
}

export interface PieAction {
  id: string;
  label: string;
  icon: string;
  run(ctx: ActionContext): Promise<void>;
}
