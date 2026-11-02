import { nativeImage, type NativeImage } from "electron";

/** A filled circle as a tray icon, drawn in code so there are no binary assets yet. */
function circle(size: number, [r, g, b]: [number, number, number]): NativeImage {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const radius = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      const i = (y * size + x) * 4; // BGRA
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export const trayIcons = {
  idle: () => circle(16, [120, 120, 130]),
  recording: () => circle(16, [220, 38, 38]),
};
