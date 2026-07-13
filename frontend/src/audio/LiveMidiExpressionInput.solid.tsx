import { onCleanup, onMount } from "solid-js";
import { isNative } from "../ipc/bridge";
import { useInstrumentStore, useProjectStore } from "../state/store";
import { useSynthStore } from "../state/synthStore";
import type { Instrument } from "../state/types";
import { createLiveMidiExpressionTracker } from "./liveMidiExpression";

export function LiveMidiExpressionInput() {
  if (isNative()) return null;

  const trackers = new Map<string, ReturnType<typeof createLiveMidiExpressionTracker>>();
  const attachedInputs = new Set<MIDIInput>();
  let midiAccess: MIDIAccess | null = null;

  onMount(() => {
    const requestMIDIAccess = navigator.requestMIDIAccess?.bind(navigator);
    if (!requestMIDIAccess) return;
    void requestMIDIAccess({ sysex: false })
      .then((access) => {
        midiAccess = access;
        attachInputs();
        access.onstatechange = attachInputs;
      })
      .catch((error: unknown) => {
        console.debug("[Beat] Web MIDI expression input unavailable", error);
      });
  });

  onCleanup(() => {
    for (const input of attachedInputs) input.onmidimessage = null;
    attachedInputs.clear();
    if (midiAccess) midiAccess.onstatechange = null;
    for (const instrumentId of trackers.keys()) useSynthStore.getState().clearInstrumentExpressionActivity(instrumentId);
    trackers.clear();
  });

  function attachInputs() {
    if (!midiAccess) return;
    const currentInputs = new Set<MIDIInput>();
    for (const input of midiAccess.inputs.values()) {
      currentInputs.add(input);
      if (attachedInputs.has(input)) continue;
      input.onmidimessage = (event) => {
        if (event.data) handleMidiData(event.data);
      };
      attachedInputs.add(input);
    }
    for (const input of Array.from(attachedInputs)) {
      if (currentInputs.has(input)) continue;
      input.onmidimessage = null;
      attachedInputs.delete(input);
    }
  }

  function handleMidiData(data: ArrayLike<number>) {
    const instruments = monitoredExpressionInstruments();
    const activeInstrumentIds = new Set(instruments.map((instrument) => instrument.id));
    for (const knownId of Array.from(trackers.keys())) {
      if (!activeInstrumentIds.has(knownId)) {
        trackers.delete(knownId);
        useSynthStore.getState().clearInstrumentExpressionActivity(knownId);
      }
    }
    for (const instrument of instruments) {
      const tracker = trackers.get(instrument.id) ?? createLiveMidiExpressionTracker();
      trackers.set(instrument.id, tracker);
      const snapshot = tracker.applyData(data);
      if (!snapshot) {
        useSynthStore.getState().clearInstrumentExpressionActivity(instrument.id);
        continue;
      }
      useSynthStore.getState().setInstrumentExpressionActivity(instrument.id, {
        source: "midi",
        activeNotes: snapshot.activeNotes,
        pitchBendSemitones: snapshot.pitchBendSemitones,
        velocity: snapshot.velocity,
        keytrack: snapshot.keytrack,
        modWheel: snapshot.modWheel,
        pressure: snapshot.pressure,
        timbre: snapshot.timbre,
      });
    }
  }

  return null;
}

function monitoredExpressionInstruments(): Instrument[] {
  const instruments = useInstrumentStore.getState().instruments;
  const byId = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const result = new Map<string, Instrument>();
  for (const track of useProjectStore.getState().project.tracks) {
    if (track.kind !== "midi" && track.kind !== "mixed") continue;
    if (!track.instrumentId || (!track.recordArmed && !track.inputMonitoring)) continue;
    const instrument = byId.get(track.instrumentId);
    if (!instrument || !isExpressionInstrument(instrument)) continue;
    result.set(instrument.id, instrument);
  }
  return Array.from(result.values());
}

function isExpressionInstrument(instrument: Instrument): boolean {
  return instrument.kind === "synth" || instrument.kind === "wavetable" || Boolean(instrument.synthPatch);
}
