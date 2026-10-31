// Radar ("star") chart geometry, shared by the scout's rating star and the robot comparison star.

/**
 * The SVG point for axis `index` of `count`, `fraction` (0-1, clamped) of the way out from the centre.
 * Axes start at 12 o'clock and go clockwise, which is how these charts are read.
 */
export function radarPoint(center, radius, index, count, fraction) {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const distance = radius * Math.max(0, Math.min(1, Number(fraction) || 0));
  return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
}
