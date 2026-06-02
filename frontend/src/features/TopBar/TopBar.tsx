import { Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { saveProject } from "../../persistence/dexie";
import { primeTimelineAudio, stopTimelineAudio } from "../../audio/timelineAudio";
import { TimeSignatureControl } from "../Transport/TimeSignatureControl";
import { BrandMark } from "./BrandMark";
import { InlineNumber } from "./InlineNumber";
import styles from "./TopBar.module.css";

/**
 * TopBar — single sleek strip holding all global controls.
 *
 *   [▣ logo  ⚙]  [⏮ ▶ ⏹]  0:00:00  4/4∨  BPM 120   ……  [💾 ⤓]
 *
 * - Every icon button is 32×32 with an 8px row gap.
 * - Time display, time-sig, and BPM inputs share one unified
 *   input-frame style so they read as a single horizontal "playback" row.
 */
export function TopBar() {
  const { playing, positionBeat } = useTransportStore();
  const transport = useTransportStore();
  const bpm = useProjectStore((s) => s.project.bpm);
  const ts = useProjectStore((s) => s.project.timeSignature);
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const setBpm = useProjectStore((s) => s.setBpm);
  const setTs = useProjectStore((s) => s.setTimeSignature);
  const setLengthBeats = useProjectStore((s) => s.setLengthBeats);
  const project = useProjectStore((s) => s.project);
  const openEditor = useUiStore((s) => s.openEditor);

  async function onSave() {
    await Promise.all([
      saveProject(project),
      send({ kind: "project.save", project }),
    ]);
  }
  function onPlay() {
    primeTimelineAudio();
    transport.play();
    void send({ kind: "transport.play" });
  }
  function onPause() {
    transport.pause();
    stopTimelineAudio();
    void send({ kind: "transport.pause" });
  }
  function onStop() {
    transport.stop();
    stopTimelineAudio();
    void send({ kind: "transport.stop" });
  }
  function onRestart() {
    primeTimelineAudio();
    transport.setPosition(0);
    transport.play();
    void send({ kind: "transport.restart" });
  }
  return (
    <header className={styles.bar}>
      {/* Left: brand + preferences */}
      <div className={styles.brand}>
        <BrandMark />
        <HoverInfo content="Preferences">
          <Button
            iconOnly
            size="md"
            onClick={() => openEditor({ kind: "preferences" })}
            aria-label="Preferences"
          >
            <Icon name="ph:gear" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content="Synth editor">
          <Button
            iconOnly
            size="md"
            onClick={() => openEditor({ kind: "synth" })}
            aria-label="Synth editor"
          >
            <Icon name="ph:wave-sine" size={16} decorative />
          </Button>
        </HoverInfo>
      </div>

      {/* Center: transport + playback section */}
      <div className={styles.playback}>
        <HoverInfo content="Restart">
          <Button iconOnly size="md" onClick={onRestart} aria-label="Restart">
            <Icon name="ph:skip-back-fill" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={playing ? "Pause (Space)" : "Play (Space)"}>
          <Button
            iconOnly
            size="md"
            variant={playing ? "primary" : "default"}
            onClick={playing ? onPause : onPlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            <Icon name={playing ? "ph:pause-fill" : "ph:play-fill"} size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content="Stop (.)">
          <Button iconOnly size="md" onClick={onStop} aria-label="Stop">
            <Icon name="ph:stop-fill" size={16} decorative />
          </Button>
        </HoverInfo>

        <span className={`${styles.field} ${styles.timeField}`}>
          {formatClock(positionBeat, bpm)} / {formatClock(lengthBeats, bpm)}
        </span>

        <InlineNumber
          label="Length"
          value={lengthBeats}
          min={4}
          max={4096}
          step={4}
          onChange={setLengthBeats}
        />

        <TimeSignatureControl value={ts} onChange={setTs} />

        <InlineNumber label="BPM" value={bpm} min={20} max={999} step={1} onChange={setBpm} />
      </div>

      <div className={styles.spacer} />

      {/* Right: save / export */}
      <div className={styles.actions}>
        <HoverInfo content="Save project (⌘S)">
          <Button iconOnly size="md" onClick={onSave} aria-label="Save">
            <Icon name="ph:floppy-disk" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content="Export to WAV">
          <Button
            iconOnly
            size="md"
            onClick={() => send({ kind: "project.exportWav" })}
            aria-label="Export"
          >
            <Icon name="ph:export" size={16} decorative />
          </Button>
        </HoverInfo>
      </div>
    </header>
  );
}

function formatClock(beat: number, bpm: number): string {
  const seconds = (beat * 60) / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}
