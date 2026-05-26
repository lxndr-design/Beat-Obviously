import { Icon, HoverInfo } from "../../components";
import type { Instrument } from "../../state/types";
import styles from "./WaveformPicker.module.css";

type Waveform = Instrument["waveform"];

interface Option {
  value: Waveform;
  icon: string;
  label: string;
}

const OPTIONS: Option[] = [
  { value: "sine",     icon: "ph:wave-sine",      label: "Sine"     },
  { value: "saw",      icon: "ph:wave-sawtooth",  label: "Saw"      },
  { value: "square",   icon: "ph:wave-square",    label: "Square"   },
  { value: "triangle", icon: "ph:wave-triangle",  label: "Triangle" },
  { value: "noise",    icon: "ph:waveform",       label: "Noise"    },
];

export interface WaveformPickerProps {
  value: Waveform;
  /** When true, "sample" appears as an extra option (hybrid only). */
  allowSample?: boolean;
  onChange: (v: Waveform) => void;
}

/**
 * WaveformPicker — radio-group of icon buttons, one per waveform shape.
 *
 * The selected option is filled (inverted bg). Hovering the selected option
 * dims it to the off-white token, matching the rest of the active-surface
 * hover rule. Hovering an unselected option color-inverts as usual.
 */
export function WaveformPicker({ value, allowSample, onChange }: WaveformPickerProps) {
  const opts = allowSample
    ? [...OPTIONS, { value: "sample" as Waveform, icon: "ph:music-notes-simple", label: "Sample" }]
    : OPTIONS;
  const selected = opts.find((o) => o.value === value);

  return (
    <div className={styles.wrap}>
      <div className={styles.row} role="radiogroup" aria-label="Waveform">
        {opts.map((o) => (
          <HoverInfo key={o.value} content={o.label}>
            <button
              type="button"
              role="radio"
              aria-checked={value === o.value}
              aria-label={o.label}
              className={`${styles.btn} ${value === o.value ? styles.active : ""}`}
              onClick={() => onChange(o.value)}
            >
              <Icon name={o.icon} size={16} decorative />
            </button>
          </HoverInfo>
        ))}
      </div>
      <div className={styles.selectedLabel}>{selected?.label ?? value}</div>
    </div>
  );
}
