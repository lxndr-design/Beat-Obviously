import { createMemo, For, type Accessor } from "solid-js";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import type { Instrument } from "../../state/types";
import styles from "./WaveformPicker.module.css";

type Waveform = Instrument["waveform"];

interface Option {
  value: Waveform;
  icon: string;
  label: string;
}

const OPTIONS: Option[] = [
  { value: "sine", icon: "ph:wave-sine", label: "Sine" },
  { value: "saw", icon: "ph:wave-sawtooth", label: "Saw" },
  { value: "square", icon: "ph:wave-square", label: "Square" },
  { value: "triangle", icon: "ph:wave-triangle", label: "Triangle" },
  { value: "noise", icon: "ph:waveform", label: "Noise" },
];

export interface WaveformPickerProps {
  value: Waveform;
  allowSample?: boolean;
  allowWavetable?: boolean;
  onChange: (value: Waveform) => void;
}

export function WaveformPicker(props: WaveformPickerProps) {
  return <WaveformPickerRuntime state={() => props} />;
}

function WaveformPickerRuntime(props: { state: Accessor<WaveformPickerProps> }) {
  const opts = createMemo(() => [
    ...OPTIONS,
    ...(props.state().allowSample ? [{ value: "sample" as Waveform, icon: "ph:music-notes-simple", label: "Sample" }] : []),
    ...(props.state().allowWavetable ? [{ value: "wavetable" as Waveform, icon: "ph:waveform", label: "Wavetable" }] : []),
  ]);
  const selected = createMemo(() => opts().find((option) => option.value === props.state().value));

  return (
    <div class={styles.wrap}>
      <div class={styles.row} role="radiogroup" aria-label="Waveform">
        <For each={opts()}>
          {(option) => (
            <HoverInfo content={option.label}>
              <Button
                iconOnly
                size="md"
                variant="ghost"
                selected={props.state().value === option.value}
                role="radio"
                aria-checked={props.state().value === option.value}
                aria-label={option.label}
                className={styles.btn}
                onClick={() => props.state().onChange(option.value)}
              >
                <Icon name={option.icon} size={18} decorative />
              </Button>
            </HoverInfo>
          )}
        </For>
      </div>
      <div class={styles.selectedLabel}>{selected()?.label ?? props.state().value}</div>
    </div>
  );
}
