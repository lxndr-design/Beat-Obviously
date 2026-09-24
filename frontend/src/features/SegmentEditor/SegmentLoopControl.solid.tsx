import { Button, NumberInput } from "../../solid-ui";
import styles from "./SegmentLoopControl.module.css";

interface Props {
  repeats: number;
  onChange: (repeats: number) => void;
}

export function SegmentLoopControl(props: Props) {
  const enabled = () => props.repeats > 0;

  return (
    <section class={styles.control} aria-label="Segment loop settings">
      <Button
        className={styles.loopButton}
        selected={enabled()}
        aria-pressed={enabled()}
        aria-label="Loop segment"
        onClick={() => props.onChange(enabled() ? 0 : Math.max(1, Math.round(props.repeats) || 1))}
      >
        Loop
      </Button>
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
    </section>
  );
}
