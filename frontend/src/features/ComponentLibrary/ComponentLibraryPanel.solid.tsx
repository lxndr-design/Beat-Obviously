import { createSignal, For, onCleanup, Show } from "solid-js";
import { Button, Icon, RowItem, SectionRibbon, createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { appPrompt } from "../../components";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import { DEFAULT_DRUM_MIDI_PITCH, DEFAULT_DRUM_VELOCITY, drumTimingOffsetBeats, normalizeDrumCell } from "../../state/drumSteps";
import { useComponentStore, type BeatComponent } from "../../state/components";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { Instrument, MidiNote } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./ComponentLibraryPanel.module.css";

interface ComponentLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function ComponentLibraryPanelSolid(props: ComponentLibraryPanelProps) {
  const components = createStoreSelector(useComponentStore, (s) => s.components);
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const bpm = createStoreSelector(useProjectStore, (s) => s.project.bpm);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  let playback: ComponentPlayback | null = null;

  onCleanup(() => stopComponentPlayback(playback));

  function togglePreview(component: BeatComponent) {
    if (playingId() === component.id) {
      stopComponentPlayback(playback);
      playback = null;
      setPlayingId(null);
      return;
    }

    stopComponentPlayback(playback);
    playback = playComponentPreview(component, instruments(), bpm(), () => {
      playback = null;
      setPlayingId(null);
    });
    setPlayingId(component.id);
  }

  return (
    <div class={styles.panel}>
      <SectionRibbon
        title="Components"
        expanded={props.expanded}
        onToggle={props.onToggle}
        showToggle={false}
        count={components().length}
      />

      <ul class={`${styles.list} ${props.expanded ? styles.listOpen : ""}`} aria-hidden={!props.expanded}>
        <Show when={components().length === 0}>
          <li class={styles.empty}>
            Right-click a MIDI or drum segment to save it as a component.
          </li>
        </Show>
        <For each={components()}>
          {(component) => (
            <ComponentItem
              component={component}
              itemCount={component.kind === "drum"
                ? component.rows.reduce((sum, row) => sum + row.steps.filter(Boolean).length, 0)
                : component.notes.length}
              playing={playingId() === component.id}
              onTogglePreview={() => togglePreview(component)}
            />
          )}
        </For>
      </ul>
    </div>
  );
}

interface ItemProps {
  component: BeatComponent;
  itemCount: number;
  playing: boolean;
  onTogglePreview: () => void;
}

function ComponentItem(props: ItemProps) {
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Edit",
      icon: "ph:pencil-line",
      onSelect: () => useUiStore.getState().openEditor({ kind: "component", componentId: props.component.id }),
    },
    {
      label: "Rename",
      icon: "ph:pencil-simple",
      onSelect: () => void renameComponent(props.component),
    },
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: () => useComponentStore.getState().remove(props.component.id),
      separatorBefore: true,
    },
  ]);

  async function renameComponent(component: BeatComponent) {
    const next = await appPrompt("Component name", component.name);
    if (next != null) useComponentStore.getState().rename(component.id, next);
  }

  function onDragStart(event: DragEvent) {
    event.dataTransfer?.setData("application/x-beat-component", props.component.id);
    event.dataTransfer?.setData("text/plain", props.component.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  }

  const kind = () => props.component.kind ?? "midi";

  return (
    <RowItem
      className={styles.componentRow}
      density="compact"
      cursor="grab"
      draggable
      onDragStart={onDragStart}
      onContextMenu={menu.onContextMenu}
      title={`${props.itemCount} ${kind() === "drum" ? "hit" : "note"}${props.itemCount === 1 ? "" : "s"} · ${componentPlaybackLength(props.component)} beats`}
      icon={kind() === "drum" ? <span class={styles.drumIcon} aria-hidden /> : <Icon name="ph:piano-keys" size={14} decorative />}
      hoverIcon={<Icon name="ph:dots-six-vertical" size={14} decorative />}
      name={props.component.name}
      action={(
        <Button
          className={styles.itemPreviewButton}
          iconOnly
          size="sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onTogglePreview();
          }}
          aria-label={`${props.playing ? "Pause" : "Play"} ${props.component.name}`}
        >
          <Icon name={props.playing ? "ph:pause-fill" : "ph:play-fill"} size={12} decorative />
        </Button>
      )}
    >
      {menu.menu()}
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
