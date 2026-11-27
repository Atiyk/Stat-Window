function buzz(ms: number | number[]): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

export const feedback = {
  lock(): void {
    buzz(12);
  },
  hit(points: number): void {
    buzz(points >= 90 ? [14, 50, 14, 50, 24] : [14, 50, 18]);
  },
  miss(): void {
    buzz(40);
  },
};
