// Overlay sizes and placement. Pure functions so they can be unit-tested without Electron.

export const OVERLAY_SIZE = {
  compact: { width: 360, height: 120 },
  expanded: { width: 360, height: 520 },
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MARGIN = 16;

/** Default spot: top-right corner of the work area. */
export function defaultOverlayPosition(workArea: Rect, expanded: boolean): { x: number; y: number } {
  const size = expanded ? OVERLAY_SIZE.expanded : OVERLAY_SIZE.compact;
  return { x: workArea.x + workArea.width - size.width - MARGIN, y: workArea.y + MARGIN };
}

/** Keep the whole overlay inside the work area (e.g. after a monitor is unplugged or it expands). */
export function clampToWorkArea(
  pos: { x: number; y: number },
  expanded: boolean,
  workArea: Rect,
): { x: number; y: number } {
  const size = expanded ? OVERLAY_SIZE.expanded : OVERLAY_SIZE.compact;
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: Math.round(Math.min(Math.max(pos.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, workArea.y), maxY)),
  };
}
