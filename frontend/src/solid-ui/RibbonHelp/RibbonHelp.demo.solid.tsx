import { RibbonHelp } from "./RibbonHelp.solid";

export function RibbonHelpDemo() {
  return (
    <section>
      <h2>Solid RibbonHelp</h2>
      <div style={{ display: "inline-flex", "align-items": "center", gap: "3px" }}>
        <span>Tracks</span>
        <RibbonHelp
          label="Tracks"
          pages={[
            {
              title: "Arrange the song",
              body: "Drag segments through time or between compatible tracks, then double-click one to edit its contents.",
            },
            {
              title: "Control and automate",
              body: "Track headers provide playback, recording, level, automation, and routing controls.",
            },
          ]}
        />
      </div>
    </section>
  );
}
