import type { AutomationCurve } from "../state/types";

export const AUTOMATION_CURVES: AutomationCurve[] = [
  "hold",
  "linear",
  "quadratic",
  "cubic",
  "easeIn",
  "easeOut",
  "smoothstep",
];

export function automationCurveLabel(curve: AutomationCurve): string {
  switch (curve) {
    case "hold":
      return "Hold";
    case "quadratic":
      return "Quadratic";
    case "cubic":
      return "Cubic";
    case "easeIn":
      return "Ease In";
    case "easeOut":
      return "Ease Out";
    case "smoothstep":
      return "Smoothstep";
    case "linear":
    default:
      return "Linear";
  }
}

export function evaluateAutomationCurve(
  curve: AutomationCurve | undefined,
  startValue: number,
  endValue: number,
  t: number,
): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const delta = endValue - startValue;
  switch (curve) {
    case "hold":
      return startValue;
    case "quadratic":
    case "easeIn":
      return startValue + delta * clamped * clamped;
    case "cubic":
      return startValue + delta * clamped * clamped * clamped;
    case "easeOut": {
      const inv = 1 - clamped;
      return endValue - delta * inv * inv;
    }
    case "smoothstep":
      return startValue + delta * clamped * clamped * (3 - 2 * clamped);
    case "linear":
    default:
      return startValue + delta * clamped;
  }
}
