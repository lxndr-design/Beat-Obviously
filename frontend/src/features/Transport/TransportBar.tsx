import { useState } from "react";
import { Button, Icon, NumberInput, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { TimeSignatureModal } from "./TimeSignatureModal";
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
  const { playing, positionBeat, speed, loopRange } = useTransportStore();
  const bpm = useProjectStore((s) => s.project.bpm);
  const ts = useProjectStore((s) => s.project.timeSignature);
  const setBpm = useProjectStore((s) => s.setBpm);
  const setTs = useProjectStore((s) => s.setTimeSignature);
  const transport = useTransportStore();
  const [tsModalOpen, setTsModalOpen] = useState(false);
  const [tsMenuOpen, setTsMenuOpen] = useState(false);

  async function onPlay() {
    transport.play();
    await send({ kind: "transport.play" });
  }
  async function onPause() {
    transport.pause();
    await send({ kind: "transport.pause" });
  }
  async function onStop() {
    transport.stop();
    await send({ kind: "transport.stop" });
  }
  async function onRestart() {
    transport.setPosition(0);
    transport.play();
    await send({ kind: "transport.seek", positionBeat: 0 });
    await send({ kind: "transport.play" });
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
        {loopRange && (
          <span className={styles.loop}>
            ⟲ {formatClock(loopRange.startBeat, bpm)} – {formatClock(loopRange.endBeat, bpm)}
          </span>
        )}
      </div>

      <div className={styles.spacer} />

      {/* Playback section */}
      <div className={styles.playback}>
        <div className={styles.tsWrap}>
          <HoverInfo content="Time signature">
            <button
              type="button"
              className={styles.tsBtn}
              onClick={() => setTsMenuOpen((v) => !v)}
              aria-label="Time signature"
              aria-expanded={tsMenuOpen}
            >
              {ts.num}/{ts.denom}
              <Icon name="ph:caret-up" size={16} decorative />
            </button>
          </HoverInfo>
          {tsMenuOpen && (
            <div className={styles.dropUp} role="menu">
              {TS_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={styles.dropItem}
                  onClick={() => {
                    const [n, d] = preset.split("/").map(Number);
                    setTs({ num: n, denom: d, boldBeats: [1] });
                    setTsMenuOpen(false);
                  }}
                >
                  {preset}
                </button>
              ))}
              <div className={styles.dropSep} />
              <button
                type="button"
                className={styles.dropItem}
                onClick={() => {
                  setTsMenuOpen(false);
                  setTsModalOpen(true);
                }}
              >
                Custom…
              </button>
            </div>
          )}
        </div>

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

      {tsModalOpen && <TimeSignatureModal onClose={() => setTsModalOpen(false)} />}
    </div>
  );
}

const TS_PRESETS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"];

/** Format a beat-position as M:SS:cs clock time using the current BPM. */
function formatClock(beat: number, bpm: number): string {
  const seconds = (beat * 60) / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}
