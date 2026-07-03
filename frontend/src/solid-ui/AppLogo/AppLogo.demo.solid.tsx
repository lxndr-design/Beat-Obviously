import { AppLogo } from "./AppLogo.solid";

export function AppLogoDemo() {
  return (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <span style={{ width: "18px", height: "18px", color: "var(--color-fg)" }}>
        <AppLogo />
      </span>
      <span style={{ width: "32px", height: "32px", color: "var(--color-fg)" }}>
        <AppLogo />
      </span>
    </div>
  );
}
