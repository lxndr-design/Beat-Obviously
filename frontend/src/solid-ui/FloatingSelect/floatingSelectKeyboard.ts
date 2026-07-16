export type FloatingSelectNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextFloatingSelectOptionIndex(
  key: FloatingSelectNavigationKey,
  activeIndex: number,
  optionCount: number,
): number | null {
  if (optionCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (key === "ArrowUp") return Math.max(0, activeIndex < 0 ? optionCount - 1 : activeIndex - 1);
  return Math.min(optionCount - 1, activeIndex < 0 ? 0 : activeIndex + 1);
}
