import { MarqueeText } from "./MarqueeText.solid";

export function MarqueeTextDemo() {
  return (
    <section>
      <h2>Solid MarqueeText</h2>
      <div style={{ width: "160px", border: "var(--border-soft)", padding: "4px" }}>
        <MarqueeText text="Imported Decent Sampler Percussion Palette Long Name" />
      </div>
    </section>
  );
}
