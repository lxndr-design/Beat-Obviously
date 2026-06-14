import { useEffect, useRef, useState } from "react";
import { Button, Icon, RowItem, SectionRibbon, appPrompt, useContextMenu, type ContextMenuItem } from "../../components";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import { DEFAULT_DRUM_MIDI_PITCH, DEFAULT_DRUM_VELOCITY, drumTimingOffsetBeats, normalizeDrumCell } from "../../state/drumSteps";
import { useComponentStore, type BeatComponent } from "../../state/components";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { Instrument, MidiNote } from "../../state/types";
import styles from "./ComponentLibraryPanel.module.css";

/**
 * ComponentLibraryPanel — sidebar Components section.
 *
 * Mirrors InstrumentLibraryPanel: collapsible header + indented list.
 * Components are draggable onto track lanes (mime: x-beat-component).
 */
interface ComponentLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function ComponentLibraryPanel({ expanded, onToggle }: ComponentLibraryPanelProps) {
  const components = useComponentStore((s) => s.components);
  const remove = useComponentStore((s) => s.remove);
  const rename = useComponentStore((s) => s.rename);
  const instruments = useInstrumentStore((s) => s.instruments);
  const openEditor = useUiStore((s) => s.openEditor);
  const bpm = useProjectStore((s) => s.project.bpm);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playbackRef = useRef<ComponentPlayback | null>(null);

  useEffect(() => () => stopComponentPlayback(playbackRef.current), []);

  function togglePreview(component: BeatComponent) {
    if (playingId === component.id) {
      stopComponentPlayback(playbackRef.current);
      playbackRef.current = null;
      setPlayingId(null);
      return;
    }

    stopComponentPlayback(playbackRef.current);
    playbackRef.current = playComponentPreview(component, instruments, bpm, () => {
      playbackRef.current = null;
      setPlayingId(null);
    });
    setPlayingId(component.id);
  }

  return (
    <div className={styles.panel}>
      <SectionRibbon
        title="Components"
        expanded={expanded}
        onToggle={onToggle}
        showToggle={false}
        count={components.length}
      />

      <ul className={`${styles.list} ${expanded ? styles.listOpen : ""}`} aria-hidden={!expanded}>
        {components.length === 0 && (
          <li className={styles.empty}>
            Right-click a MIDI or drum segment to save it as a component.
          </li>
        )}
        {components.map((c) => (
          <ComponentItem
            key={c.id}
            component={c}
            itemCount={c.kind === "drum"
              ? c.rows.reduce((sum, row) => sum + row.steps.filter(Boolean).length, 0)
              : c.notes.length}
            playing={playingId === c.id}
            onTogglePreview={() => togglePreview(c)}
            onEdit={() => openEditor({ kind: "component", componentId: c.id })}
            onRemove={() => remove(c.id)}
            onRename={() => void (async () => {
              const next = await appPrompt("Component name", c.name);
              if (next != null) rename(c.id, next);
            })()}
          />
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

interface ItemProps {
  component: BeatComponent;
  itemCount: number;
  playing: boolean;
  onTogglePreview: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRename: () => void;
}

function ComponentItem({
  component,
  itemCount,
  playing,
  onTogglePreview,
  onEdit,
  onRemove,
  onRename,
}: ItemProps) {
  const kind = component.kind ?? "midi";
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    { label: "Edit", icon: "ph:pencil-line", onSelect: onEdit },
    { label: "Rename", icon: "ph:pencil-simple", onSelect: onRename },
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: onRemove,
      separatorBefore: true,
    },
  ]);

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData("application/x-beat-component", component.id);
    e.dataTransfer.setData("text/plain", component.name);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <RowItem
      className={styles.componentRow}
      density="compact"
      cursor="grab"
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
      title={`${itemCount} ${kind === "drum" ? "hit" : "note"}${itemCount === 1 ? "" : "s"} · ${componentPlaybackLength(component)} beats`}
      icon={kind === "drum" ? <span className={styles.drumIcon} aria-hidden /> : <Icon name="ph:piano-keys" size={14} decorative />}
      hoverIcon={<Icon name="ph:dots-six-vertical" size={14} decorative />}
      name={component.name}
      action={(
        <Button
          className={styles.itemPreviewButton}
          iconOnly
          size="sm"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePreview();
          }}
          aria-label={`${playing ? "Pause" : "Play"} ${component.name}`}
        >
          <Icon name={playing ? "ph:pause-fill" : "ph:play-fill"} size={12} decorative />
        </Button>
      )}
    >
      {menu}
    </RowItem>
  );
}

export interface ComponentPlayback {
  ctx: AudioContext;
  sources: Set<AudioBufferSourceNode>;
  gains: Set<GainNode>;
  timers: number[];
  onDone: () => void;
  doneTimer: number;
}

export function playComponentPreview(
  component: BeatComponent,
  instruments: Instrument[],
  bpm: number,
  onDone: () => void,
  speedMultiplier = 1,
  donePaddingMs = 80,
): ComponentPlayback {
  const ctx = getComponentPreviewCtx();
  if (ctx.state === "suspended") void ctx.resume();

  const playback: ComponentPlayback = {
    ctx,
    sources: new Set(),
    gains: new Set(),
    timers: [],
    onDone,
    doneTimer: 0,
  };

  const previewSpeed = Math.max(0.25, Math.min(4, speedMultiplier));
  const secondsPerBeat = (60 / Math.max(1, bpm)) / previewSpeed;
  const durationBeats = component.kind === "drum" ? component.lengthBeats / component.speed : component.lengthBeats;
  const durationSeconds = Math.max(0.1, durationBeats * secondsPerBeat);
  const now = ctx.currentTime;

  if (component.kind === "drum") {
    const stepLengthBeats = durationBeats / Math.max(1, component.stepCount);
    for (const row of component.rows) {
      const instrument = instruments.find((i) => i.id === row.instrumentId) ?? instruments[0] ?? fallbackInstrument;
      if (instrument.sampleUrl) {
        void preloadInstrumentSample(ctx, instrument).catch(() => undefined);
      }
      for (let step = 0; step < component.stepCount; step++) {
        const cell = normalizeDrumCell(row.steps[step]);
        if (!cell.on) continue;
        const at = now + (
          step * stepLengthBeats +
          drumTimingOffsetBeats(step, stepLengthBeats, component.swingPercent, cell.leanPercent)
        ) * secondsPerBeat;
        schedulePreviewNote(
          playback,
          instrument,
          cell.pitchHz ?? component.defaultPitchHz ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument),
          at,
          Math.max(0.05, Math.min(0.18, stepLengthBeats * secondsPerBeat)),
          cell.velocity ?? DEFAULT_DRUM_VELOCITY,
        );
      }
    }
  } else {
    const instrument = instruments.find((i) => i.id === component.instrumentId) ?? instruments[0] ?? fallbackInstrument;
    if (instrument.sampleUrl) {
      void preloadInstrumentSample(ctx, instrument).catch(() => undefined);
    }
    for (const note of component.notes) {
      schedulePreviewMidiNote(playback, note, instrument, now, secondsPerBeat);
    }
  }

  playback.doneTimer = window.setTimeout(() => {
    stopComponentPlayback(playback);
    onDone();
  }, Math.ceil(durationSeconds * 1000) + Math.max(0, donePaddingMs));

  return playback;
}

function schedulePreviewMidiNote(
  playback: ComponentPlayback,
  note: MidiNote,
  instrument: Instrument,
  startTime: number,
  secondsPerBeat: number,
) {
  schedulePreviewNote(
    playback,
    instrument,
    note.frequencyHz ?? noteFrequency(note.pitch, instrument),
    startTime + note.startBeat * secondsPerBeat,
    Math.max(0.03, note.lengthBeats * secondsPerBeat),
    note.velocity,
  );
}

function schedulePreviewNote(
  playback: ComponentPlayback,
  instrument: Instrument,
  frequencyHz: number,
  atTimeS: number,
  durationS: number,
  velocity: number,
) {
  const source = createInstrumentBufferSource(playback.ctx, instrument, durationS + 0.05, frequencyHz, undefined, velocity);
  const playbackDuration = source.buffer
    ? Math.max(durationS, Math.min(1.5, source.buffer.duration / source.playbackRate.value))
    : durationS;
  const gain = playback.ctx.createGain();
  const peak = (Math.max(0, Math.min(127, velocity)) / 127) * 0.24;
  const release = Math.min(0.12, playbackDuration * 0.5);
  gain.gain.setValueAtTime(0, atTimeS);
  gain.gain.linearRampToValueAtTime(peak, atTimeS + 0.005);
  gain.gain.setValueAtTime(peak, atTimeS + Math.max(0, playbackDuration - release));
  gain.gain.linearRampToValueAtTime(0, atTimeS + playbackDuration);
  source.connect(gain);
  gain.connect(playback.ctx.destination);
  source.onended = () => {
    playback.sources.delete(source);
    playback.gains.delete(gain);
    source.disconnect();
    gain.disconnect();
  };
  playback.sources.add(source);
  playback.gains.add(gain);
  source.start(atTimeS);
  source.stop(atTimeS + playbackDuration + 0.03);
}

export function stopComponentPlayback(playback: ComponentPlayback | null) {
  if (!playback) return;
  window.clearTimeout(playback.doneTimer);
  for (const timer of playback.timers) window.clearTimeout(timer);
  for (const source of playback.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }
  for (const gain of playback.gains) gain.disconnect();
  playback.sources.clear();
  playback.gains.clear();
}

let componentPreviewCtx: AudioContext | null = null;

function getComponentPreviewCtx(): AudioContext {
  if (!componentPreviewCtx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    componentPreviewCtx = new Ctor();
  }
  return componentPreviewCtx;
}

function componentPlaybackLength(component: BeatComponent): string {
  const beats = component.kind === "drum"
    ? component.lengthBeats / Math.max(1, component.speed)
    : component.lengthBeats;
  return Number.isInteger(beats) ? `${beats}` : beats.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

const fallbackInstrument: Instrument = {
  id: "component-preview-fallback",
  name: "Component Preview",
  kind: "synth",
  envelope: { attackMs: 5, decayMs: 100, sustain: 0.6, releaseMs: 160 },
  knobs: { cutoff: 0.6, resonance: 0.15, drive: 0.1, color: 0.5 },
  waveform: "saw",
  sampleIds: [],
  userCreated: false,
};
