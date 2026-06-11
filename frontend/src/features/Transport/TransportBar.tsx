import { Button, Icon, NumberInput, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { pauseTransport, playTransport, restartTransport, stopTransport } from "../../audio/transportActions";
import { TimeSignatureControl } from "./TimeSignatureControl";
import styles from "./TransportBar.module.css";

/**
 * TransportBar — bottom strip.
 *
 * Left:    Restart / Play / Stop
 * Middle:  Time display (M:SS:cs), loop range if active
 * Right:   Playback section — Time signature, BPM, Speed%
 *
 * The playback section is grouped tightly next to the time controls per
 * spec. Time signature uses a drop-up popover; speed is shown as a
 * percentage (internally still a multiplier).
 */
export function TransportBar() {
  const { playing, positionBeat, speed, loopEnabled, loopRange } = useTransportStore();
  const bpm = useProjectStore((s) => s.project.bpm);
  const ts = useProjectStore((s) => s.project.timeSignature);
  const setBpm = useProjectStore((s) => s.setBpm);
  const setTs = useProjectStore((s) => s.setTimeSignature);
  const transport = useTransportStore();

  function onPlay() {
    playTransport();
  }
  function onPause() {
    pauseTransport();
  }
  function onStop() {
    stopTransport();
  }
  function onRestart() {
    restartTransport();
  }
  async function onSpeedPercent(p: number) {
    const mult = p / 100;
    transport.setSpeed(mult);
    await send({ kind: "transport.setSpeed", speed: mult });
  }

  return (
    <div className={styles.bar}>
      <div className={styles.transport}>
        <HoverInfo content="Restart from beginning">
          <Button onClick={onRestart} aria-label="Restart" iconOnly size="md">
            <Icon name="ph:skip-back-fill" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={playing ? "Pause (Space)" : "Play (Space)"}>
          <Button
            onClick={playing ? onPause : onPlay}
            aria-label={playing ? "Pause" : "Play"}
            iconOnly
            size="md"
            variant={playing ? "primary" : "default"}
          >
            <Icon
              name={playing ? "ph:pause-fill" : "ph:play-fill"}
              size={16}
              decorative
            />
          </Button>
        </HoverInfo>
        <HoverInfo content="Stop (.)">
          <Button onClick={onStop} aria-label="Stop" iconOnly size="md">
            <Icon name="ph:stop-fill" size={16} decorative />
          </Button>
        </HoverInfo>

        <span className={styles.timeDisplay}>{formatClock(positionBeat, bpm)}</span>
        {loopEnabled && loopRange.endBeat > loopRange.startBeat && (
          <span className={styles.loop}>
            ⟲ {formatClock(loopRange.startBeat, bpm)} – {formatClock(loopRange.endBeat, bpm)}
          </span>
        )}
      </div>

      <div className={styles.spacer} />

      {/* Playback section */}
      <div className={styles.playback}>
        <TimeSignatureControl value={ts} onChange={setTs} direction="up" />

        <NumberInput
          label="BPM"
          value={bpm}
          min={20}
          max={999}
          step={1}
          onChange={setBpm}
        />
        <NumberInput
          label="Speed"
          value={Math.round(speed * 100)}
          min={10}
          max={400}
          step={5}
          unit="%"
          onChange={onSpeedPercent}
        />
      </div>

    </div>
  );
}

/** Format a beat-position as M:SS:cs clock time using the current BPM. */
function formatClock(beat: number, bpm: number): string {
  const seconds = (beat * 60) / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}
