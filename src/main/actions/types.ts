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

export interface RegionImage {
  /** PNG file in TEMP_DIR. The caller deletes it. */
  path: string;
  /** Selected box in screen DIP. */
  rect: Rect;
}

export interface ActionContext {
  /** Screen point (DIP) of the cursor when the hotkey was pressed. */
  cursor: Point;
  /** Returns "" when nothing is selected. */
  getSelectedText(): Promise<string>;
  /** Lets the user drag a box on screen. Returns null when cancelled. */
  selectRegion(): Promise<RegionImage | null>;
  runClaude(o: RunOptions): ClaudeRun;
  showPopup(anchor: Point): PopupHandle;
  openChat(): void;
  openTodo(): void;
}

export interface PieAction {
  id: string;
  label: string;
  icon: string;
  run(ctx: ActionContext): Promise<void>;
}
