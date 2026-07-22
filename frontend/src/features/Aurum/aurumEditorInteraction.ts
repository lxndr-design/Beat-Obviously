export const AURUM_EDITOR_TAB_COUNT = 7;

export function aurumTabIndexAfterKey(currentIndex: number, key: string, tabCount = AURUM_EDITOR_TAB_COUNT) {
  const count = Math.max(1, Math.round(tabCount));
  const current = Math.max(0, Math.min(count - 1, Math.round(currentIndex)));
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return current;
}
