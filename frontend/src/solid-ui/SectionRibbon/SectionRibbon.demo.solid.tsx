import { createSignal } from "solid-js";
import { Icon } from "../Icon";
import { SectionRibbon, SectionRibbonActionButton } from "./SectionRibbon.solid";

export function SectionRibbonSolidDemo() {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <section>
      <h2>Solid SectionRibbon</h2>
      <SectionRibbon
        title="Instruments"
        expanded={expanded()}
        onToggle={() => setExpanded(!expanded())}
        count={9}
        actions={<SectionRibbonActionButton aria-label="Add"><Icon name="ph:plus" decorative /></SectionRibbonActionButton>}
      />
    </section>
  );
}
