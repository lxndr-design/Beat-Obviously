import { Icon, NumberInput, Toggle } from "../../solid-ui";
import styles from "./SegmentLoopControl.module.css";

interface Props {
  repeats: number;
  lengthBeats: number;
  onChange: (repeats: number) => void;
}

export function SegmentLoopControl(props: Props) {
  const totalPlays = () => Math.max(1, Math.round(props.repeats) + 1);
  const totalBeats = () => Math.max(0, props.lengthBeats) * totalPlays();
  const enabled = () => props.repeats > 0;

  return (
    <section class={styles.control} aria-label="Segment loop settings">
      <div class={styles.lead}>
        <Icon name="ph:repeat" size={18} decorative />
        <div class={styles.copy}>
          <span class={styles.title}>Loop playback</span>
          <span class={styles.hint}>Repeat count excludes the original clip.</span>
        </div>
      </div>
      <Toggle
        checked={enabled()}
        aria-label="Enable segment looping"
        onChange={(next) => props.onChange(next ? Math.max(1, Math.round(props.repeats) || 1) : 0)}
      />
      <NumberInput
        className={styles.repeatInput}
        layout="inline"
        label="Repeats"
        ariaLabel="Segment repeat count"
        value={Math.max(1, Math.round(props.repeats) || 1)}
        min={1}
        max={127}
        step={1}
        maxLength={3}
        disabled={!enabled()}
        onChange={(value) => props.onChange(Math.max(1, Math.min(127, Math.round(value))))}
      />
      <span class={styles.summary}>
        {enabled()
          ? `${props.repeats} ${props.repeats === 1 ? "repeat" : "repeats"} · ${totalPlays()} plays`
          : "Loop off"} · {formatBeats(totalBeats())}
      </span>
    </section>
  );
}

function formatBeats(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? "beat" : "beats"}`;
}
