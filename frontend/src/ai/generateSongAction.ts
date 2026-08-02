import { createNewDocument } from "../persistence/documentActions";
import { runProjectHistoryGroup, useInstrumentStore, useProjectStore, useUiStore } from "../state/store";
import { generateSongPlan, type GenerateSongOptions, type GeneratedSongPlan } from "./songGenerator";

export interface GeneratedSongInstallResult {
  plan: GeneratedSongPlan;
  createdInstrumentNames: string[];
  reusedInstrumentNames: string[];
  externalAcquisitionSuggestions: string[];
}

export async function createGeneratedSongProject(options: GenerateSongOptions): Promise<GeneratedSongInstallResult | null> {
  if (!await createNewDocument()) return null;
  const plan = generateSongPlan(options);
  if (plan.pitchNicheIssues.length > 0)
    throw new Error(`Generated instrumentation failed pitch-niche validation: ${plan.pitchNicheIssues[0]}`);

  const createdInstrumentNames: string[] = [];
  const reusedInstrumentNames: string[] = [];
  const externalAcquisitionSuggestions: string[] = [];
  const instrumentIds = new Map<string, string>();
  plan.voices.forEach((voice, index) => {
    const flavor = instrumentFlavor(`${plan.genre}|${plan.speed}|${plan.randomness}|${voice.role}|${index}`);
    const generatedName = `Generated · ${voice.instrument.preferredName}`;
    const instrumentId = useInstrumentStore.getState().addInstrument({
      name: generatedName,
      kind: "wavetable",
      waveform: voice.instrument.fallback.waveform,
      envelope: {
        attackMs: voice.instrument.fallback.attackMs * (0.88 + flavor * 0.24),
        decayMs: Math.max(80, voice.instrument.fallback.releaseMs * (0.48 + flavor * 0.18)),
        sustain: voice.role === "rhythm" ? 0.12 + flavor * 0.12 : 0.64 + flavor * 0.18,
        releaseMs: voice.instrument.fallback.releaseMs * (0.86 + flavor * 0.28),
      },
      knobs: {
        cutoff: clamp01(voice.instrument.fallback.cutoff + (flavor - 0.5) * 0.16),
        resonance: clamp01(voice.instrument.fallback.resonance + (flavor - 0.5) * 0.1),
        drive: clamp01(voice.instrument.fallback.drive + flavor * 0.08),
        color: clamp01((voice.texture === "reed" ? 0.64 : voice.texture === "plucked" ? 0.42 : 0.5) + (flavor - 0.5) * 0.2),
      },
      lfoWaveform: index % 2 === 0 ? "sine" : "triangle",
      lfoRateHz: plan.speed === "hyper" ? 10 + flavor * 6 : plan.speed === "passive" ? 0.08 + flavor * 0.3 : 1 + flavor * 4,
      lfoDepth: voice.role === "harmony" ? 0.08 + flavor * 0.12 : flavor * 0.06,
      descriptors: [voice.role, voice.texture, plan.genre, plan.speed, plan.randomness, "generated-song", "generated-instrument"],
      source: { kind: "created", label: "Start from Something instrument generation", edited: false },
      userCreated: true,
    });
    instrumentIds.set(voice.role, instrumentId);
    const created = useInstrumentStore.getState().instruments.find((instrument) => instrument.id === instrumentId);
    createdInstrumentNames.push(created?.name ?? generatedName);
    if (voice.instrument.acquisition)
      externalAcquisitionSuggestions.push(`${voice.instrument.preferredName}: ${voice.instrument.acquisition.provider} ${voice.instrument.acquisition.format} (${voice.instrument.acquisition.license})`);
  });

  const createdTrackIds: string[] = [];
  const createdSegmentIds: string[] = [];
  runProjectHistoryGroup(() => {
    const projectStore = useProjectStore.getState();
    projectStore.rename(plan.name);
    projectStore.setBpm(plan.bpm);
    projectStore.setLengthBeats(plan.lengthBeats);

    const initialBlankTrack = projectStore.project.tracks.length === 1
      && projectStore.project.tracks[0].segments.length === 0
      ? projectStore.project.tracks[0].id
      : null;

    for (const voice of plan.voices) {
      const trackId = projectStore.addTrack({
        name: voice.instrument.preferredName,
        kind: "midi",
        instrumentId: instrumentIds.get(voice.role),
      });
      createdTrackIds.push(trackId);
      for (const segment of voice.segments) {
        if (segment.notes.length === 0) continue;
        const segmentId = projectStore.addSegment(trackId, {
          name: segment.name,
          startBeat: segment.startBeat,
          lengthBeats: segment.lengthBeats,
          repeats: segment.repeats,
          layer: 0,
          muted: false,
          instrumentId: instrumentIds.get(voice.role),
          payload: { kind: "midi", notes: segment.notes.map((note) => ({ ...note })), gainDb: segment.gainDb },
        });
        createdSegmentIds.push(segmentId);
      }
    }
    if (initialBlankTrack) projectStore.removeTrack(initialBlankTrack);
  });

  useUiStore.getState().setSelectedTracks(createdTrackIds.slice(0, 1));
  useUiStore.getState().setSelectedSegments(createdSegmentIds.slice(0, 1));
  return { plan, createdInstrumentNames, reusedInstrumentNames, externalAcquisitionSuggestions };
}

function instrumentFlavor(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
