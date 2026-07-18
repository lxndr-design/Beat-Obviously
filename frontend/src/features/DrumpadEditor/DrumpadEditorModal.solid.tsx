import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { nanoid as nano } from "nanoid";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { getTimelineAudioContext } from "../../audio/timelineAudio";
import { Button, FloatingSelect, Icon, MicroButton, Modal, TextInput } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { selectSegment } from "../../state/selectors";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { DrumpadHit, DrumpadLane, DrumpadPayload, Id, Instrument, Segment } from "../../state/types";
import {
  DRUMPAD_HIT_PREVIEW_SECONDS,
  drumpadHitDurationSeconds,
  drumpadHitLengthBeats,
  preservedDrumpadRecordingView,
} from "./drumpadPlayback";
import styles from "./DrumpadEditorModal.module.css";

interface Props {
  segmentId: Id;
  discardIfUntouched?: boolean;
}

interface KeyDef {
  code: string;
  label: string;
  wide?: boolean;
  xwide?: boolean;
  xxwide?: boolean;
}

interface KeyboardLinkLine {
  id: Id;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface KeyboardLinkFrame {
  width: number;
  height: number;
  lines: KeyboardLinkLine[];
}

interface DraggingHitState {
  primaryId: Id;
  ids: Id[];
  startX: number;
  originalStartBeats: Record<Id, number>;
}

interface MarqueeState {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  additive: boolean;
  baseIds: Id[];
}

const MAC_KEYS: KeyDef[][] = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "Delete"].map((label) => ({ code: keyCode(label), label, xwide: label === "Delete" })),
  [{ code: "Tab", label: "Tab", wide: true }, ..."QWERTYUIOP".split("").map((label) => ({ code: keyCode(label), label })), { code: "BracketLeft", label: "[" }, { code: "BracketRight", label: "]" }, { code: "Backslash", label: "\\", wide: true }],
  [{ code: "CapsLock", label: "Caps", xwide: true }, ..."ASDFGHJKL".split("").map((label) => ({ code: keyCode(label), label })), { code: "Semicolon", label: ";" }, { code: "Quote", label: "'" }, { code: "Enter", label: "Enter", xwide: true }],
  [{ code: "ShiftLeft", label: "Shift", xxwide: true }, ..."ZXCVBNM".split("").map((label) => ({ code: keyCode(label), label })), { code: "Comma", label: "," }, { code: "Period", label: "." }, { code: "Slash", label: "/" }, { code: "ShiftRight", label: "Shift", xxwide: true }],
];

const WINDOWS_KEYS: KeyDef[][] = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "Backspace"].map((label) => ({ code: keyCode(label), label, xwide: label === "Backspace" })),
  [{ code: "Tab", label: "Tab", wide: true }, ..."QWERTYUIOP".split("").map((label) => ({ code: keyCode(label), label })), { code: "BracketLeft", label: "[" }, { code: "BracketRight", label: "]" }, { code: "Backslash", label: "\\", wide: true }],
  [{ code: "CapsLock", label: "Caps", xwide: true }, ..."ASDFGHJKL".split("").map((label) => ({ code: keyCode(label), label })), { code: "Semicolon", label: ";" }, { code: "Quote", label: "'" }, { code: "Enter", label: "Enter", xwide: true }],
  [{ code: "ShiftLeft", label: "Shift", xxwide: true }, ..."ZXCVBNM".split("").map((label) => ({ code: keyCode(label), label })), { code: "Comma", label: "," }, { code: "Period", label: "." }, { code: "Slash", label: "/" }, { code: "ShiftRight", label: "Shift", xxwide: true }],
];

const LIVE_WINDOW_SECONDS = 8;
const MIN_DRUMPAD_LENGTH_BEATS = 4;
const DRUMPAD_LANE_HEAD_WIDTH_PX = 240;
const MIN_DRUMPAD_VIEW_BEATS = 1;
const DRUMPAD_WHEEL_ZOOM_FACTOR = 0.002;
const DRUMPAD_FINE_TICKS_PER_BEAT = 8;

export function DrumpadEditorModal(props: Props) {
  let bodyRef: HTMLDivElement | undefined;
  let trackTimelineRef: HTMLDivElement | undefined;
  let countdownTimer: number | undefined;
  let recordRaf: number | undefined;
  let playbackRaf: number | undefined;
  let keyboardLinkRaf: number | undefined;
  let keyboardLinkRetryRaf: number | undefined;
  let playbackStartedAt = 0;
  let playbackStartBeat = 0;
  let recordStartedAt = 0;
  let recordStartBeat = 0;
  let previewCtx: AudioContext | null = null;
  const activePreviewSources = new Set<AudioBufferSourceNode>();
  const activePreviewGains = new Set<GainNode>();
  let playbackScheduled = new Set<Id>();
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const source = createStoreSelector(useProjectStore, () => selectSegment(props.segmentId));
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const closeEditor = useUiStore.getState().closeEditor;
  const setSelectedSegments = useUiStore.getState().setSelectedSegments;
  const updateSegment = useProjectStore.getState().updateSegment;
  const removeSegment = useProjectStore.getState().removeSegment;
  const [draft, setDraftInternal] = createSignal<Segment | null>(null, { equals: false });
  const [touched, setTouched] = createSignal(false);
  const [mappingLaneId, setMappingLaneId] = createSignal<Id | null>(null);
  const [countdown, setCountdown] = createSignal(0);
  const [recording, setRecording] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [playheadBeat, setPlayheadBeat] = createSignal(0);
  const [activeKeys, setActiveKeys] = createSignal<Set<string>>(new Set(), { equals: false });
  const [selectedHitIds, setSelectedHitIds] = createSignal<Set<Id>>(new Set(), { equals: false });
  const [draggingHit, setDraggingHit] = createSignal<DraggingHitState | null>(null);
  const [marquee, setMarquee] = createSignal<MarqueeState | null>(null, { equals: false });
  const [laneSelectOpen, setLaneSelectOpen] = createSignal<Id | null>(null);
  const [keyboardLinkFrame, setKeyboardLinkFrame] = createSignal<KeyboardLinkFrame>({ width: 1, height: 1, lines: [] }, { equals: false });
  const [trackViewStartBeat, setTrackViewStartBeat] = createSignal(0);
  const [trackViewLengthBeats, setTrackViewLengthBeats] = createSignal(Number.POSITIVE_INFINITY);

  function markTouched() {
    if (props.discardIfUntouched) setTouched(true);
  }

  function setDraft(next: Segment | null | ((current: Segment | null) => Segment | null)) {
    markTouched();
    setDraftInternal(next as Segment | null);
  }

  createEffect(() => {
    const seg = source();
    if (!seg || seg.payload.kind !== "drumpad") return;
    setDraftInternal(structuredClone(seg));
    setSelectedHitIds(new Set<Id>());
    setTrackViewStartBeat(0);
    setTrackViewLengthBeats(Math.max(seg.lengthBeats, MIN_DRUMPAD_LENGTH_BEATS, ...seg.payload.hits.map((hit) => hit.startBeat + hit.lengthBeats)));
  });

 onCleanup(() => {
    if (countdownTimer) window.clearInterval(countdownTimer);
    if (recordRaf) window.cancelAnimationFrame(recordRaf);
    if (playbackRaf) window.cancelAnimationFrame(playbackRaf);
    if (keyboardLinkRaf) window.cancelAnimationFrame(keyboardLinkRaf);
    if (keyboardLinkRetryRaf) window.cancelAnimationFrame(keyboardLinkRetryRaf);
    stopPreviewAudio();
    if (previewCtx) void previewCtx.close();
    window.removeEventListener("keydown", onWindowKeyDown, true);
    window.removeEventListener("keyup", onWindowKeyUp, true);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("resize", queueMeasureKeyboardLinks);
  });

  createEffect(() => {
    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("resize", queueMeasureKeyboardLinks);
  });

  createEffect(() => {
    const element = bodyRef;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(queueMeasureKeyboardLinks);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  const payload = createMemo<DrumpadPayload | null>(() => {
    const seg = draft();
    return seg?.payload.kind === "drumpad" ? seg.payload : null;
  });
  const lanes = createMemo(() => payload()?.lanes ?? []);
  const hits = createMemo(() => payload()?.hits ?? []);
  const keyboard = createMemo(() => payload()?.keyboardLayout === "windows" ? WINDOWS_KEYS : MAC_KEYS);
  const keyboardCodes = createMemo(() => new Set(keyboard().flat().map((key) => key.code)));
  const assignedByCode = createMemo(() => {
    const map = new Map<string, DrumpadLane>();
    for (const lane of lanes()) {
      if (lane.keyCode) map.set(lane.keyCode, lane);
    }
    return map;
  });
  const instrumentOptions = createMemo(() =>
    instruments().map((instrument) => ({ value: instrument.id, label: instrument.name }))
  );
  const timelineLengthBeats = createMemo(() => Math.max(draft()?.lengthBeats ?? MIN_DRUMPAD_LENGTH_BEATS, playheadBeat(), ...hits().map((hit) => hit.startBeat + hit.lengthBeats), MIN_DRUMPAD_LENGTH_BEATS));
  const visibleLengthBeats = createMemo(() => recording()
    ? Math.max(MIN_DRUMPAD_LENGTH_BEATS, LIVE_WINDOW_SECONDS * (project().bpm / 60))
    : Math.min(timelineLengthBeats(), Math.max(MIN_DRUMPAD_VIEW_BEATS, trackViewLengthBeats())));
  const visibleStartBeat = createMemo(() => recording()
    ? Math.max(0, playheadBeat() - visibleLengthBeats())
    : clampBeat(trackViewStartBeat(), 0, Math.max(0, timelineLengthBeats() - visibleLengthBeats())));
  const visibleEndBeat = createMemo(() => visibleStartBeat() + visibleLengthBeats());
  const visibleTickBeatStep = createMemo(() => {
    const length = visibleLengthBeats();
    if (length <= 64) return 1 / DRUMPAD_FINE_TICKS_PER_BEAT;
    if (length <= 128) return 0.25;
    return 1;
  });
  const trackGridLines = createMemo(() => {
    const start = visibleStartBeat();
    const end = visibleEndBeat();
    const length = Math.max(0.0001, visibleLengthBeats());
    const step = visibleTickBeatStep();
    const measureBeats = measureLengthBeats(project().timeSignature);
    const lines: Array<{ beat: number; progress: string; kind: "measure" | "beat" | "fine" }> = [];
    const first = Math.ceil(start / step) * step;
    for (let beat = first; beat <= end + 0.0001; beat += step) {
      const roundedBeat = roundBeat(beat);
      const kind = isBeatMultiple(roundedBeat, measureBeats)
        ? "measure"
        : isBeatMultiple(roundedBeat, 1)
          ? "beat"
          : "fine";
      lines.push({
        beat: roundedBeat,
        progress: `${(roundedBeat - start) / length}`,
        kind,
      });
    }
    return lines;
  });
  const visibleHitRows = createMemo(() => {
    const start = visibleStartBeat();
    const end = visibleEndBeat();
    const map = new Map<Id, DrumpadHit[]>();
    for (const lane of lanes()) map.set(lane.id, []);
    for (const hit of hits()) {
      const hitEnd = hit.startBeat + hit.lengthBeats;
      if (hitEnd <= start || hit.startBeat >= end) continue;
      map.get(hit.laneId)?.push(hit);
    }
    return map;
  });
  const playheadLeft = createMemo(() => {
    const left = ((playheadBeat() - visibleStartBeat()) / Math.max(0.0001, visibleLengthBeats())) * 100;
    return Math.max(0, Math.min(100, left));
  });
  const playheadSeconds = createMemo(() => (playheadBeat() * 60) / Math.max(1, project().bpm));
  const playheadProgress = createMemo(() => `${playheadLeft() / 100}`);
  const selectedHitCount = createMemo(() => selectedHitIds().size);
  const dirty = createMemo(() => JSON.stringify(draft()) !== JSON.stringify(source()));

  createEffect(() => {
    if (!playing()) {
      if (playbackRaf) window.cancelAnimationFrame(playbackRaf);
      playbackRaf = undefined;
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, (performance.now() - playbackStartedAt) / 1000);
      const beatsPerSecond = project().bpm / 60;
      let nextBeat = playbackStartBeat + seconds * beatsPerSecond;
      if (nextBeat >= timelineLengthBeats()) {
        nextBeat = 0;
        playbackStartBeat = 0;
        playbackStartedAt = performance.now();
        playbackScheduled = new Set();
      }
      setPlayheadBeat(nextBeat);
      schedulePlaybackHits(nextBeat);
      playbackRaf = window.requestAnimationFrame(tick);
    };

    playbackRaf = window.requestAnimationFrame(tick);
    onCleanup(() => {
      if (playbackRaf) window.cancelAnimationFrame(playbackRaf);
      playbackRaf = undefined;
    });
  });

  createEffect(() => {
    lanes().map((lane) => `${lane.id}:${lane.keyCode ?? ""}`).join("|");
    keyboard().flat().map((key) => key.code).join("|");
    queueMeasureKeyboardLinks();
  });

  createEffect(() => {
    if (recording()) return;
    const timelineLength = timelineLengthBeats();
    setTrackViewLengthBeats((current) => clampBeat(current, MIN_DRUMPAD_VIEW_BEATS, timelineLength));
    setTrackViewStartBeat((current) => clampBeat(current, 0, Math.max(0, timelineLength - visibleLengthBeats())));
  });

  onMount(() => queueMeasureKeyboardLinks());

  function setPayload(next: DrumpadPayload) {
    setDraft((current) => current ? { ...current, payload: next } : current);
  }

  function updatePayload(mutator: (payload: DrumpadPayload) => DrumpadPayload) {
    const current = payload();
    if (!current) return;
    setPayload(mutator(current));
  }

  function setOnlySelectedHit(hitId: Id) {
    setSelectedHitIds(new Set([hitId]));
  }

  function selectAllHits() {
    setSelectedHitIds(new Set(hits().map((hit) => hit.id)));
  }

  function alignSelectedHitsToNearestNotch() {
    const selected = selectedHitIds();
    if (selected.size === 0) return;
    const step = visibleTickBeatStep();
    updatePayload((current) => ({
      ...current,
      hits: current.hits.map((hit) => selected.has(hit.id)
        ? { ...hit, startBeat: snapBeatToStep(hit.startBeat, step) }
        : hit),
    }));
  }

  function addLane() {
    const used = new Set(lanes().map((lane) => lane.instrumentId).filter(Boolean));
    const instrument = instruments().find((candidate) => !used.has(candidate.id)) ?? instruments()[0];
    const lane: DrumpadLane = {
      id: nano(),
      instrumentId: instrument?.id,
      name: instrument?.name ?? `Instrument ${lanes().length + 1}`,
      muted: false,
      pitch: 60,
    };
    updatePayload((current) => ({ ...current, lanes: [...current.lanes, lane] }));
  }

  function toggleLaneMute(laneId: Id) {
    updatePayload((current) => ({
      ...current,
      lanes: current.lanes.map((lane) => lane.id === laneId ? { ...lane, muted: !lane.muted } : lane),
    }));
  }

  function changeLaneInstrument(laneId: Id, instrumentId: Id) {
    const instrument = instruments().find((candidate) => candidate.id === instrumentId);
    if (!instrument) return;
    updatePayload((current) => ({
      ...current,
      lanes: current.lanes.map((lane) => lane.id === laneId ? {
        ...lane,
        instrumentId,
        name: instrument?.name ?? lane.name,
      } : lane),
    }));
  }

  function queueMeasureKeyboardLinks() {
    if (keyboardLinkRaf) window.cancelAnimationFrame(keyboardLinkRaf);
    keyboardLinkRaf = window.requestAnimationFrame(measureKeyboardLinks);
  }

  function measureKeyboardLinks() {
    keyboardLinkRaf = undefined;
    if (!bodyRef) return;
    const bodyRect = bodyRef.getBoundingClientRect();
    const lines: KeyboardLinkLine[] = [];
    let pendingNodes = false;
    for (const lane of lanes()) {
      if (!lane.keyCode) continue;
      const keyEl = bodyRef.querySelector<HTMLElement>(`[data-drumpad-key="${lane.keyCode}"]`);
      const lanePlugEl = bodyRef.querySelector<HTMLElement>(`[data-drumpad-lane-plug="${lane.id}"]`);
      if (!keyEl || !lanePlugEl) {
        pendingNodes = true;
        continue;
      }
      const keyRect = keyEl.getBoundingClientRect();
      const lanePlugRect = lanePlugEl.getBoundingClientRect();
      lines.push({
        id: lane.id,
        x1: keyRect.left + keyRect.width / 2 - bodyRect.left,
        y1: keyRect.top + keyRect.height / 2 - bodyRect.top,
        x2: lanePlugRect.left + lanePlugRect.width / 2 - bodyRect.left,
        y2: lanePlugRect.top + lanePlugRect.height / 2 - bodyRect.top,
      });
    }
    setKeyboardLinkFrame({
      width: Math.max(1, bodyRect.width),
      height: Math.max(1, bodyRect.height),
      lines,
    });
    if (pendingNodes) {
      if (keyboardLinkRetryRaf) window.cancelAnimationFrame(keyboardLinkRetryRaf);
      keyboardLinkRetryRaf = window.requestAnimationFrame(() => {
        keyboardLinkRetryRaf = undefined;
        queueMeasureKeyboardLinks();
      });
    }
  }

  function previewContext(): AudioContext {
    if (!previewCtx) {
      previewCtx = getTimelineAudioContext();
    }
    if (previewCtx.state === "suspended") void previewCtx.resume().catch(() => undefined);
    return previewCtx;
  }

  function stopPreviewAudio() {
    for (const source of Array.from(activePreviewSources)) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    for (const gain of Array.from(activePreviewGains)) {
      try {
        gain.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    activePreviewSources.clear();
    activePreviewGains.clear();
  }

  function laneInstrument(lane: DrumpadLane): Instrument | undefined {
    return instruments().find((instrument) => instrument.id === lane.instrumentId);
  }

  function auditionLane(lane: DrumpadLane, velocity = 110, atTimeS?: number, durationS = DRUMPAD_HIT_PREVIEW_SECONDS) {
    if (lane.muted) return;
    const instrument = laneInstrument(lane);
    if (!instrument) return;
    const audioCtx = previewContext();
    const startTimeS = Math.max(atTimeS ?? audioCtx.currentTime, audioCtx.currentTime + 0.001);
    const source = createInstrumentBufferSource(
      audioCtx,
      instrument,
      durationS + 0.05,
      noteFrequency(lane.pitch ?? 60, instrument),
      undefined,
      velocity,
      project().bpm,
    );
    const gain = audioCtx.createGain();
    const peak = Math.max(0, Math.min(0.32, (velocity / 127) * 0.28));
    gain.gain.setValueAtTime(0, startTimeS);
    gain.gain.linearRampToValueAtTime(peak, startTimeS + 0.004);
    gain.gain.setValueAtTime(peak, startTimeS + durationS * 0.72);
    gain.gain.linearRampToValueAtTime(0, startTimeS + durationS);
    source.connect(gain).connect(audioCtx.destination);
    activePreviewSources.add(source);
    activePreviewGains.add(gain);
    const cleanup = () => {
      activePreviewSources.delete(source);
      activePreviewGains.delete(gain);
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected.
      }
    };
    source.onended = cleanup;
    source.start(startTimeS);
    source.stop(startTimeS + durationS + 0.05);
  }

  function addHitForLane(lane: DrumpadLane, keyCode: string) {
    const current = payload();
    if (!current) return;
    const seconds = Math.max(0, (performance.now() - recordStartedAt) / 1000);
    const quantizedSeconds = Math.round(seconds / current.quantizeSeconds) * current.quantizeSeconds;
    const startBeat = recordStartBeat + quantizedSeconds * (project().bpm / 60);
    const lengthBeats = drumpadHitLengthBeats(project().bpm);
    const hit: DrumpadHit = {
      id: nano(),
      laneId: lane.id,
      startBeat,
      lengthBeats,
      velocity: 110,
      keyCode,
    };
    updatePayload((payload) => ({ ...payload, hits: [...payload.hits, hit] }));
    setPlayheadBeat(startBeat);
  }

  function triggerKeyCode(code: string, options: { record?: boolean } = {}) {
    const lane = assignedByCode().get(code);
    if (!lane || lane.muted) return false;
    auditionLane(lane);
    if (options.record) addHitForLane(lane, code);
    return true;
  }

  function startPlayback() {
    if (recording()) stopRecording();
    stopPreviewAudio();
    playbackScheduled = new Set();
    playbackStartBeat = playheadBeat();
    playbackStartedAt = performance.now();
    setPlaying(true);
  }

  function pausePlayback() {
    setPlaying(false);
    stopPreviewAudio();
  }

  function togglePlayback() {
    if (playing()) pausePlayback();
    else startPlayback();
  }

  function schedulePlaybackHits(positionBeat: number) {
    const audioCtx = previewContext();
    const beatsPerSecond = project().bpm / 60;
    const lookaheadBeats = Math.max(0.25, beatsPerSecond * 0.18);
    for (const hit of hits()) {
      if (playbackScheduled.has(hit.id)) continue;
      if (hit.startBeat < positionBeat || hit.startBeat > positionBeat + lookaheadBeats) continue;
      const lane = lanes().find((candidate) => candidate.id === hit.laneId);
      if (!lane) continue;
      const delayS = (hit.startBeat - positionBeat) / beatsPerSecond;
      auditionLane(
        lane,
        hit.velocity,
        audioCtx.currentTime + delayS,
        drumpadHitDurationSeconds(hit.lengthBeats, project().bpm),
      );
      playbackScheduled.add(hit.id);
    }
  }

  function assignKey(key: KeyDef) {
    const laneId = mappingLaneId();
    if (!laneId) return;
    updatePayload((current) => ({
      ...current,
      lanes: current.lanes.map((lane) => lane.id === laneId ? { ...lane, keyCode: key.code, keyLabel: key.label || key.code } : lane),
    }));
    setMappingLaneId(null);
    queueMeasureKeyboardLinks();
  }

  function onWindowKeyDown(event: KeyboardEvent) {
    const isDisplayedKey = keyboardCodes().has(event.code);
    if ((event.metaKey || event.ctrlKey) && !mappingLaneId()) return;
    if (mappingLaneId() && isDisplayedKey && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const key = keyboard().flat().find((candidate) => candidate.code === event.code);
      if (key) assignKey(key);
      return;
    }
    if (recording()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    } else if (isTextEntryTarget(event.target)) {
      return;
    }
    if (isDisplayedKey) {
      setActiveKeys((current) => {
        const next = new Set(current);
        next.add(event.code);
        return next;
      });
    }
    if (event.repeat || !isDisplayedKey) return;
    triggerKeyCode(event.code, { record: recording() });
  }

  function onWindowKeyUp(event: KeyboardEvent) {
    if (recording()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    setActiveKeys((current) => {
      if (!current.has(event.code)) return current;
      const next = new Set(current);
      next.delete(event.code);
      return next;
    });
  }

  function updateRecordingClock() {
    if (!recording()) return;
    const seconds = Math.max(0, (performance.now() - recordStartedAt) / 1000);
    const nextBeat = recordStartBeat + seconds * (project().bpm / 60);
    setPlayheadBeat(nextBeat);
    setDraftInternal((current) => current ? { ...current, lengthBeats: Math.max(current.lengthBeats, nextBeat, MIN_DRUMPAD_LENGTH_BEATS) } : current);
    recordRaf = window.requestAnimationFrame(updateRecordingClock);
  }

  function beginRecording() {
    markTouched();
    if (playing()) pausePlayback();
    recordStartBeat = playheadBeat();
    recordStartedAt = performance.now();
    setRecording(true);
    if (recordRaf) window.cancelAnimationFrame(recordRaf);
    recordRaf = window.requestAnimationFrame(updateRecordingClock);
  }

  function startRecording() {
    if (recording() || countdown() > 0) {
      setRecording(false);
      setCountdown(0);
      if (countdownTimer) window.clearInterval(countdownTimer);
      return;
    }
    setCountdown(3);
    countdownTimer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          if (countdownTimer) window.clearInterval(countdownTimer);
          beginRecording();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }

  function stopRecording() {
    const view = preservedDrumpadRecordingView(
      visibleStartBeat(),
      visibleLengthBeats(),
      timelineLengthBeats(),
    );
    setTrackViewStartBeat(view.startBeat);
    setTrackViewLengthBeats(view.lengthBeats);
    setRecording(false);
    if (recordRaf) window.cancelAnimationFrame(recordRaf);
  }

  function jumpToStart() {
    pausePlayback();
    setPlayheadBeat(0);
  }

  function skipToEnd() {
    pausePlayback();
    setPlayheadBeat(Math.max(0, ...hits().map((hit) => hit.startBeat + hit.lengthBeats)));
  }

  function onTrackWheel(event: WheelEvent) {
    if (recording() || draggingHit()) return;
    const rect = trackTimelineRef?.getBoundingClientRect();
    if (!rect) return;
    const timelineWidth = Math.max(1, rect.width - 20 - DRUMPAD_LANE_HEAD_WIDTH_PX);
    const timelineLeft = rect.left + 10 + DRUMPAD_LANE_HEAD_WIDTH_PX;
    const pointerX = clampBeat(event.clientX - timelineLeft, 0, timelineWidth);
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const currentLength = visibleLengthBeats();
      const timelineLength = timelineLengthBeats();
      const beatUnderPointer = visibleStartBeat() + (pointerX / timelineWidth) * currentLength;
      const zoomScale = Math.exp(event.deltaY * DRUMPAD_WHEEL_ZOOM_FACTOR);
      const nextLength = clampBeat(currentLength * zoomScale, MIN_DRUMPAD_VIEW_BEATS, timelineLength);
      const nextStart = beatUnderPointer - ((beatUnderPointer - visibleStartBeat()) / currentLength) * nextLength;
      setTrackViewLengthBeats(nextLength);
      setTrackViewStartBeat(clampBeat(nextStart, 0, Math.max(0, timelineLength - nextLength)));
      return;
    }

    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (horizontalDelta === 0) return;
    event.preventDefault();
    const nextStart = visibleStartBeat() + (horizontalDelta / timelineWidth) * visibleLengthBeats();
    setTrackViewStartBeat(clampBeat(nextStart, 0, Math.max(0, timelineLengthBeats() - visibleLengthBeats())));
  }

  function hitStyle(hit: DrumpadHit) {
    const start = visibleStartBeat();
    const length = visibleLengthBeats();
    const visibleStart = clampBeat(hit.startBeat, start, visibleEndBeat());
    return {
      left: `${((visibleStart - start) / length) * 100}%`,
    };
  }

  function marqueeStyle() {
    const current = marquee();
    const rect = trackTimelineRef?.getBoundingClientRect();
    if (!current || !rect) return {};
    const left = Math.min(current.startClientX, current.currentClientX) - rect.left;
    const top = Math.min(current.startClientY, current.currentClientY) - rect.top;
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(current.currentClientX - current.startClientX)}px`,
      height: `${Math.abs(current.currentClientY - current.startClientY)}px`,
    };
  }

  function onTrackKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllHits();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedHitIds(new Set<Id>());
    }
  }

  function onTrackPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    trackTimelineRef?.focus();
    const target = event.target as HTMLElement | null;
    if (!target || target.closest("[data-drumpad-hit-id]")) return;
    if (!target.closest("[data-drumpad-hit-lane='true']")) return;
    event.preventDefault();
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    const next: MarqueeState = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      additive,
      baseIds: Array.from(selectedHitIds()),
    };
    setMarquee(next);
    updateMarqueeSelection(next);
  }

  function onHitPointerDown(event: PointerEvent, hit: DrumpadHit) {
    event.preventDefault();
    event.stopPropagation();
    trackTimelineRef?.focus();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const lane = lanes().find((candidate) => candidate.id === hit.laneId);
    if (lane) auditionLane(lane, hit.velocity);
    const additive = event.metaKey || event.ctrlKey;
    const currentSelection = selectedHitIds();
    if (additive && currentSelection.has(hit.id)) {
      const nextSelection = new Set(currentSelection);
      nextSelection.delete(hit.id);
      setSelectedHitIds(nextSelection);
      return;
    }
    if (additive) {
      const nextSelection = new Set(currentSelection);
      nextSelection.add(hit.id);
      setSelectedHitIds(nextSelection);
    } else if (!currentSelection.has(hit.id)) {
      setOnlySelectedHit(hit.id);
    }
    const dragIds = currentSelection.has(hit.id) && !additive
      ? Array.from(currentSelection)
      : additive
        ? Array.from(new Set([...currentSelection, hit.id]))
        : [hit.id];
    const originalStartBeats: Record<Id, number> = {};
    for (const candidate of hits()) {
      if (dragIds.includes(candidate.id)) originalStartBeats[candidate.id] = candidate.startBeat;
    }
    setDraggingHit({ primaryId: hit.id, ids: dragIds, startX: event.clientX, originalStartBeats });
  }

  function onWindowPointerMove(event: PointerEvent) {
    const drag = draggingHit();
    const rect = trackTimelineRef?.getBoundingClientRect();
    const activeMarquee = marquee();
    if (activeMarquee) {
      const next = { ...activeMarquee, currentClientX: event.clientX, currentClientY: event.clientY };
      setMarquee(next);
      updateMarqueeSelection(next);
      return;
    }
    if (!drag || !rect) return;
    const timelineWidth = Math.max(1, rect.width - 20 - DRUMPAD_LANE_HEAD_WIDTH_PX);
    const deltaBeats = ((event.clientX - drag.startX) / timelineWidth) * visibleLengthBeats();
    const primaryStart = drag.originalStartBeats[drag.primaryId] ?? 0;
    const rawPrimaryStart = Math.max(0, primaryStart + deltaBeats);
    const snappedPrimaryStart = event.shiftKey ? snapBeatToStep(rawPrimaryStart, visibleTickBeatStep()) : rawPrimaryStart;
    const minOriginalStart = Math.min(...drag.ids.map((id) => drag.originalStartBeats[id] ?? 0));
    const appliedDelta = Math.max(snappedPrimaryStart - primaryStart, -minOriginalStart);
    const dragIds = new Set(drag.ids);
    updatePayload((current) => ({
      ...current,
      hits: current.hits.map((hit) => dragIds.has(hit.id)
        ? { ...hit, startBeat: Math.max(0, (drag.originalStartBeats[hit.id] ?? hit.startBeat) + appliedDelta) }
        : hit),
    }));
  }

  function onWindowPointerUp() {
    setDraggingHit(null);
    setMarquee(null);
  }

  function updateMarqueeSelection(state: MarqueeState) {
    const left = Math.min(state.startClientX, state.currentClientX);
    const right = Math.max(state.startClientX, state.currentClientX);
    const top = Math.min(state.startClientY, state.currentClientY);
    const bottom = Math.max(state.startClientY, state.currentClientY);
    const selected = new Set(state.additive ? state.baseIds : []);
    trackTimelineRef?.querySelectorAll<HTMLElement>("[data-drumpad-hit-id]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom) return;
      const hitId = element.dataset.drumpadHitId;
      if (hitId) selected.add(hitId);
    });
    setSelectedHitIds(selected);
  }

  function save() {
    const current = draft();
    if (!current) return;
    updateSegment(props.segmentId, {
      name: current.name,
      lengthBeats: Math.max(current.lengthBeats, timelineLengthBeats()),
      payload: current.payload,
    });
    closeEditorOnly();
  }

  function closeEditorOnly() {
    closeEditor({ kind: "segment", segmentId: props.segmentId });
  }

  function close() {
    if (props.discardIfUntouched && !touched()) {
      removeSegment(props.segmentId);
      setSelectedSegments([]);
    }
    closeEditorOnly();
  }

  return (
    <Modal
      open
      title="Keyboard Pad"
      width="editor"
      scopeId={`drumpad-editor-${props.segmentId}`}
      flushBody
      dirty={dirty()}
      onClose={close}
      footer={
        <div class={styles.footer}>
          <div class={styles.transport}>
            <Button size="sm" onClick={() => recording() ? stopRecording() : startRecording()}>
              <Icon name={recording() ? "ph:stop-fill" : "ph:record-fill"} size={18} decorative />
              {recording() ? "Stop" : "Record"}
            </Button>
            <Button size="sm" onClick={jumpToStart} iconOnly aria-label="Skip to start" title="Skip to start">
              <Icon name="ph:skip-back" size={18} decorative />
            </Button>
            <Button
              size="sm"
              variant={playing() ? "primary" : "default"}
              onClick={togglePlayback}
              iconOnly
              aria-label={playing() ? "Pause" : "Play"}
              title={playing() ? "Pause" : "Play"}
            >
              <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
            </Button>
            <Button size="sm" onClick={skipToEnd} iconOnly aria-label="Skip to end" title="Skip to end">
              <span class={styles.skipEndIcon} aria-hidden="true" />
            </Button>
            <span class={styles.timeReadout}>{formatSeconds(playheadSeconds())}</span>
            <Show when={countdown() > 0}>
              <span class={styles.countdown}>{countdown()}</span>
            </Show>
          </div>
          <div class={styles.footerActions}>
            <Button size="sm" onClick={close}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={save}>Save</Button>
          </div>
        </div>
      }
    >
      <Show when={draft() && payload()}>
        <div class={styles.shell}>
          <div class={styles.body} ref={bodyRef}>
            <KeyboardLinkLines frame={keyboardLinkFrame()} />
            <div class={styles.fieldRow}>
              <TextInput
                layout="inline"
                label="Name"
                value={draft()?.name ?? ""}
                onInput={(event) => setDraft((current) => current ? { ...current, name: event.currentTarget.value } : current)}
              />
            </div>

            <div>
              <div class={styles.keyboardPanel}>
                <div class={styles.keyboardLayoutToggle} aria-label="Keyboard layout">
                  <Button
                    size="sm"
                    variant="ghost"
                    selected={(payload()?.keyboardLayout ?? "mac") === "mac"}
                    class={styles.layoutButton}
                    data-active={(payload()?.keyboardLayout ?? "mac") === "mac" ? "1" : undefined}
                    onClick={() => updatePayload((current) => ({ ...current, keyboardLayout: "mac" }))}
                    aria-label="Use Apple keyboard layout"
                    title="Apple keyboard"
                  >
                    <span aria-hidden="true">⌘</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    selected={payload()?.keyboardLayout === "windows"}
                    class={styles.layoutButton}
                    data-active={payload()?.keyboardLayout === "windows" ? "1" : undefined}
                    onClick={() => updatePayload((current) => ({ ...current, keyboardLayout: "windows" }))}
                    aria-label="Use Windows keyboard layout"
                    title="Windows keyboard"
                  >
                    <span aria-hidden="true">⊞</span>
                  </Button>
                </div>
                <div class={styles.keyboardWrap}>
                  <div class={styles.keyboard}>
                    <For each={keyboard()}>
                      {(row) => (
                        <div class={styles.keyRow}>
                          <For each={row}>
                            {(key) => {
                              const assigned = () => assignedByCode().get(key.code);
                              return (
                                <button
                                  type="button"
                                  class={styles.key}
                                  data-wide={key.wide ? "1" : undefined}
                                  data-xwide={key.xwide ? "1" : undefined}
                                  data-xxwide={key.xxwide ? "1" : undefined}
                                  data-assigned={assigned() ? "1" : undefined}
                                  data-pressed={activeKeys().has(key.code) ? "1" : undefined}
                                  data-target={mappingLaneId() ? "1" : undefined}
                                  data-drumpad-key={key.code}
                                  onClick={() => {
                                    if (mappingLaneId()) assignKey(key);
                                  }}
                                  onPointerDown={() => {
                                    setActiveKeys((current) => {
                                      const next = new Set(current);
                                      next.add(key.code);
                                      return next;
                                    });
                                    if (!mappingLaneId()) triggerKeyCode(key.code, { record: recording() });
                                  }}
                                  onPointerUp={() => {
                                    setActiveKeys((current) => {
                                      const next = new Set(current);
                                      next.delete(key.code);
                                      return next;
                                    });
                                  }}
                                  onPointerLeave={() => {
                                    setActiveKeys((current) => {
                                      if (!current.has(key.code)) return current;
                                      const next = new Set(current);
                                      next.delete(key.code);
                                      return next;
                                    });
                                  }}
                                  title={key.label || key.code}
                                >
                                  <span class={styles.keyLabel}>{key.label}</span>
                                  <Show when={assigned()}>
                                    <span class={styles.keyPlug}>
                                      <Icon name="ph:plug" size={18} decorative />
                                    </span>
                                  </Show>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>

            <div class={styles.trackPanel}>
              <div class={styles.sectionRibbon}>Track</div>
              <div class={styles.trackToolbar}>
                <Button size="xs" onClick={jumpToStart} iconOnly aria-label="Skip to start" title="Skip to start">
                  <Icon name="ph:skip-back" size={18} decorative />
                </Button>
                <Button
                  size="xs"
                  variant={playing() ? "primary" : "default"}
                  onClick={togglePlayback}
                  iconOnly
                  aria-label={playing() ? "Pause" : "Play"}
                  title={playing() ? "Pause" : "Play"}
                >
                  <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
                </Button>
                <Button size="xs" onClick={() => recording() ? stopRecording() : startRecording()} iconOnly aria-label={recording() ? "Stop recording" : "Record"} title="Record">
                  <Icon name={recording() ? "ph:stop-fill" : "ph:record-fill"} size={18} decorative />
                </Button>
                <Button size="xs" onClick={skipToEnd} iconOnly aria-label="Skip to end" title="Skip to end">
                  <span class={styles.skipEndIcon} aria-hidden="true" />
                </Button>
                <Button
                  size="xs"
                  onClick={alignSelectedHitsToNearestNotch}
                  disabled={selectedHitCount() === 0}
                  iconOnly
                  aria-label="Align selected hits to nearest notch"
                  title="Align selected hits to nearest notch"
                >
                  <Icon name="ph:circle-notch" size={18} decorative />
                </Button>
                <span class={styles.timeReadout}>{formatSeconds(playheadSeconds())}</span>
              </div>
              <div
                class={styles.trackRows}
                ref={trackTimelineRef}
                tabIndex={0}
                onKeyDown={onTrackKeyDown}
                onPointerDown={onTrackPointerDown}
                onWheel={onTrackWheel}
                style={{
                  "--lane-head-width": `${DRUMPAD_LANE_HEAD_WIDTH_PX}px`,
                  "--playhead-progress": playheadProgress(),
                }}
              >
                <For each={trackGridLines()}>
                  {(line) => (
                    <div
                      class={styles.gridLine}
                      data-kind={line.kind}
                      style={{ "--tick-progress": line.progress }}
                      title={`${line.beat.toFixed(3)} beats`}
	                    />
	                  )}
	                </For>
                <div class={styles.playhead} />
                <Show when={marquee()}>
                  <div class={styles.marquee} style={marqueeStyle()} />
                </Show>
                <For each={lanes()}>
                  {(lane) => (
                    <div class={styles.lane}>
                      <div class={styles.laneHead}>
                        <FloatingSelect
                          value={lane.instrumentId ?? ""}
                          ariaLabel="Lane instrument"
                          className={styles.laneSelectWrap}
                          options={instrumentOptions()}
                          open={laneSelectOpen() === lane.id}
                          searchable
                          searchPlaceholder="Search instruments"
                          onOpenChange={(open) => setLaneSelectOpen(open ? lane.id : null)}
                          onChange={(instrumentId) => changeLaneInstrument(lane.id, instrumentId)}
                        />
                        <button
                          type="button"
                          class={styles.lanePlug}
                          data-drumpad-lane-plug={lane.id}
                          data-active={mappingLaneId() === lane.id ? "1" : undefined}
                          onClick={() => setMappingLaneId(mappingLaneId() === lane.id ? null : lane.id)}
                          title="Link to keyboard key"
                        >
                          <Icon name="ph:plug" size={18} decorative />
                        </button>
                        <MicroButton
                          active={lane.muted}
                          data-active={lane.muted ? "1" : undefined}
                          onClick={() => toggleLaneMute(lane.id)}
                          aria-label="Mute lane"
                          title="Mute lane"
                        >
                          M
                        </MicroButton>
                      </div>
                      <div class={styles.hitLane} data-drumpad-hit-lane="true">
                        <For each={visibleHitRows().get(lane.id) ?? []}>
                          {(hit) => (
                            <div
                              class={styles.hit}
                              data-drumpad-hit-id={hit.id}
                              data-selected={selectedHitIds().has(hit.id) ? "1" : undefined}
                              style={hitStyle(hit)}
                              onPointerDown={(event) => onHitPointerDown(event, hit)}
                              title={`${hit.startBeat.toFixed(2)} beats`}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <div class={styles.addInstrumentRow} style={{ "--lane-head-width": `${DRUMPAD_LANE_HEAD_WIDTH_PX}px` }}>
                <Button className={styles.addInstrument} fullWidth onClick={addLane}>Add Instrument</Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </Modal>
  );
}

function KeyboardLinkLines(props: { frame: KeyboardLinkFrame }) {
  return (
    <svg
      class={styles.linkSvg}
      data-drumpad-link-svg="true"
      viewBox={`0 0 ${props.frame.width} ${props.frame.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <For each={props.frame.lines}>
        {(line) => (
          <path
            class={styles.linkPath}
            data-drumpad-link-path={line.id}
            d={`M ${line.x1} ${line.y1} C ${line.x1} ${line.y1 + 28}, ${line.x2} ${line.y2 - 28}, ${line.x2} ${line.y2}`}
          />
        )}
      </For>
    </svg>
  );
}

function keyCode(label: string): string {
  if (label === "Esc") return "Escape";
  if (label === "Del") return "Delete";
  if (label === "Delete") return "Backspace";
  if (label === "`") return "Backquote";
  if (label === "-") return "Minus";
  if (label === "=") return "Equal";
  if (label === "Backspace") return "Backspace";
  if (label.startsWith("F")) return label;
  if (/^[A-Z]$/.test(label)) return `Key${label}`;
  if (/^[0-9]$/.test(label)) return `Digit${label}`;
  const map: Record<string, string> = {
    "[": "BracketLeft",
    "]": "BracketRight",
    ";": "Semicolon",
    "'": "Quote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "\\": "Backslash",
  };
  return map[label] ?? label;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function clampBeat(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : max));
}

function measureLengthBeats(timeSignature: { num: number; denom: number } | undefined): number {
  if (!timeSignature) return 4;
  return Math.max(1, timeSignature.num * (4 / Math.max(1, timeSignature.denom)));
}

function roundBeat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isBeatMultiple(value: number, step: number): boolean {
  if (step <= 0) return false;
  return Math.abs(value / step - Math.round(value / step)) < 0.0001;
}

function snapBeatToStep(value: number, step: number): number {
  if (step <= 0) return Math.max(0, value);
  return Math.max(0, roundBeat(Math.round(value / step) * step));
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}
