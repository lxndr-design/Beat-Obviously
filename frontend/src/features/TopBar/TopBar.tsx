import { useEffect, useRef, useState } from "react";
import { Button, Icon, HoverInfo, MarqueeText } from "../../components";
import { useProjectStore, useTransportStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { pauseTransport, playTransport, restartTransport, stopTransport } from "../../audio/transportActions";
import { TimeSignatureControl } from "../Transport/TimeSignatureControl";
import { AppMenuButton } from "./AppMenuButton";
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
interface TopBarProps {
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onExportRange: () => void;
  onExportTrack: () => void;
  onRecover: () => void;
  onHealth: () => void;
  onSettings: () => void;
}

export function TopBar({ onHome, onNew, onOpen, onSave, onSaveAs, onExport, onExportRange, onExportTrack, onRecover, onHealth, onSettings }: TopBarProps) {
  const { playing, positionBeat, loopEnabled, loopRange, repeatTrackEnabled } = useTransportStore();
  const transport = useTransportStore();
  const bpm = useProjectStore((s) => s.project.bpm);
  const ts = useProjectStore((s) => s.project.timeSignature);
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const projectName = useProjectStore((s) => s.project.name);
  const setBpm = useProjectStore((s) => s.setBpm);
  const setTs = useProjectStore((s) => s.setTimeSignature);
  const setLengthBeats = useProjectStore((s) => s.setLengthBeats);
  const renameProject = useProjectStore((s) => s.rename);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState(projectName || "Untitled");
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingProjectName) setProjectNameDraft(projectName || "Untitled");
  }, [editingProjectName, projectName]);

  useEffect(() => {
    if (!editingProjectName) return;
    projectNameInputRef.current?.focus();
    projectNameInputRef.current?.select();
  }, [editingProjectName]);

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
  function onToggleLoop() {
    const nextEnabled = !loopEnabled;
    transport.setLoopEnabled(nextEnabled);
    const activeRange = nextEnabled && loopRange.endBeat > loopRange.startBeat ? loopRange : null;
    void send({ kind: "transport.setLoop", range: activeRange });
  }
  function onToggleRepeatTrack() {
    transport.setRepeatTrackEnabled(!repeatTrackEnabled);
  }
  function commitProjectName() {
    const nextName = projectNameDraft.trim() || "Untitled";
    if (nextName !== projectName) renameProject(nextName);
    setEditingProjectName(false);
  }
  return (
    <header className={styles.bar}>
      {/* Left: brand */}
      <div className={styles.brand}>
        <AppMenuButton
          onHome={onHome}
          onNew={onNew}
          onOpen={onOpen}
          onSave={onSave}
          onSaveAs={onSaveAs}
          onExport={onExport}
          onExportRange={onExportRange}
          onExportTrack={onExportTrack}
          onRecover={onRecover}
          onHealth={onHealth}
          onSettings={onSettings}
        />
        <h1 className={styles.breadcrumb}>
          <button type="button" className={styles.breadcrumbHome} onClick={onHome}>Beat</button>
          <span className={styles.breadcrumbSlash}>/</span>
          <span>Editor</span>
          <span className={styles.breadcrumbSlash}>/</span>
          {editingProjectName ? (
            <input
              ref={projectNameInputRef}
              className={styles.projectNameInput}
              value={projectNameDraft}
              onChange={(event) => setProjectNameDraft(event.currentTarget.value)}
              onBlur={commitProjectName}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitProjectName();
                if (event.key === "Escape") {
                  setProjectNameDraft(projectName || "Untitled");
                  setEditingProjectName(false);
                }
              }}
              aria-label="Project name"
            />
          ) : (
            <button
              type="button"
              className={styles.projectName}
              onDoubleClick={() => setEditingProjectName(true)}
              title="Double-click to rename project"
            >
              <MarqueeText text={projectName || "Untitled"} className={styles.projectNameText} />
            </button>
          )}
        </h1>
      </div>

      {/* Center: transport + clock */}
      <div className={styles.transport}>
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
        <HoverInfo content={loopEnabled ? "Disable review loop" : "Enable review loop"}>
          <Button
            iconOnly
            size="md"
            variant={loopEnabled ? "primary" : "default"}
            onClick={onToggleLoop}
            aria-label={loopEnabled ? "Disable review loop" : "Enable review loop"}
          >
            <Icon name="ph:arrows-in-line-horizontal" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={repeatTrackEnabled ? "Disable track repeat" : "Repeat track at end"}>
          <Button
            iconOnly
            size="md"
            variant={repeatTrackEnabled ? "primary" : "default"}
            onClick={onToggleRepeatTrack}
            aria-label={repeatTrackEnabled ? "Disable track repeat" : "Enable track repeat"}
          >
            <Icon name="ph:repeat" size={16} decorative />
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
      </div>

      {/* Right: project timing controls */}
      <div className={styles.projectControls}>
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
