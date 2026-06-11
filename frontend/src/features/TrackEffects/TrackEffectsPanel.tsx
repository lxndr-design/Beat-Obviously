import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { nanoid } from "nanoid";
import { Button, FloatingLayer, HoverInfo, Icon, NumberInput, Toggle } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import type { Id, Track } from "../../state/types";
import styles from "./TrackEffectsPanel.module.css";

type TrackEffect = Track["effects"]["filters"][number];
type EffectKind = TrackEffect["kind"];

const EFFECT_OPTIONS: Array<{ value: EffectKind; label: string }> = [
  { value: "reverb", label: "Reverb / Room" },
  { value: "delay", label: "Delay" },
  { value: "chorus", label: "Chorus" },
  { value: "phaser", label: "Phaser" },
  { value: "flanger", label: "Flanger" },
  { value: "compressor", label: "Compressor" },
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "saturator", label: "Saturator" },
  { value: "distortion", label: "Distortion" },
  { value: "bitcrush", label: "Bitcrush" },
  { value: "plugin", label: "Plugin" },
];

const EFFECT_LABELS: Record<EffectKind, string> = {
  bitcrush: "Bitcrush",
  lowpass: "Low-pass",
  highpass: "High-pass",
  saturator: "Saturator",
  distortion: "Distortion",
  reverb: "Reverb / Room",
  delay: "Delay",
  chorus: "Chorus",
  phaser: "Phaser",
  flanger: "Flanger",
  compressor: "Compressor",
  plugin: "Plugin",
};

interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

const PARAMS: Record<EffectKind, ParamSpec[]> = {
  reverb: [
    { key: "roomSize", label: "Room", min: 0, max: 100, step: 1, unit: "%" },
    { key: "damping", label: "Damp", min: 0, max: 100, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  delay: [
    { key: "timeMs", label: "Time", min: 1, max: 2000, step: 1, unit: "ms" },
    { key: "feedback", label: "Feed", min: 0, max: 95, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  chorus: [
    { key: "rateHz", label: "Rate", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
    { key: "depthMs", label: "Depth", min: 0, max: 25, step: 0.1, unit: "ms" },
    { key: "delayMs", label: "Delay", min: 1, max: 35, step: 0.1, unit: "ms" },
    { key: "feedback", label: "Feed", min: -85, max: 85, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  phaser: [
    { key: "rateHz", label: "Rate", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
    { key: "centerHz", label: "Center", min: 80, max: 8000, step: 1, unit: "Hz" },
    { key: "depthOct", label: "Depth", min: 0, max: 4, step: 0.1, unit: "oct" },
    { key: "feedback", label: "Feed", min: -85, max: 85, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  flanger: [
    { key: "rateHz", label: "Rate", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
    { key: "depthMs", label: "Depth", min: 0, max: 8, step: 0.1, unit: "ms" },
    { key: "delayMs", label: "Delay", min: 0.1, max: 15, step: 0.1, unit: "ms" },
    { key: "feedback", label: "Feed", min: -85, max: 85, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  compressor: [
    { key: "thresholdDb", label: "Thresh", min: -60, max: 0, step: 1, unit: "dB" },
    { key: "ratio", label: "Ratio", min: 1, max: 40, step: 0.1, unit: ":1" },
    { key: "attackMs", label: "Attack", min: 0.1, max: 200, step: 0.1, unit: "ms" },
    { key: "releaseMs", label: "Release", min: 1, max: 2000, step: 1, unit: "ms" },
    { key: "makeupDb", label: "Makeup", min: -24, max: 24, step: 1, unit: "dB" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  lowpass: [
    { key: "cutoffHz", label: "Cut", min: 20, max: 20000, step: 1, unit: "Hz" },
    { key: "resonance", label: "Res", min: 0, max: 100, step: 1, unit: "%" },
  ],
  highpass: [
    { key: "cutoffHz", label: "Cut", min: 20, max: 20000, step: 1, unit: "Hz" },
    { key: "resonance", label: "Res", min: 0, max: 100, step: 1, unit: "%" },
  ],
  saturator: [
    { key: "drive", label: "Drive", min: 0, max: 100, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  distortion: [
    { key: "drive", label: "Drive", min: 0, max: 100, step: 1, unit: "%" },
    { key: "shape", label: "Shape", min: 0, max: 100, step: 1, unit: "%" },
    { key: "trimDb", label: "Trim", min: 0, max: 18, step: 0.5, unit: "dB" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  bitcrush: [
    { key: "bits", label: "Bits", min: 1, max: 16, step: 1 },
    { key: "rate", label: "Rate", min: 1, max: 100, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  plugin: [
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
};

const DEFAULT_PARAMS: Record<EffectKind, Record<string, number>> = {
  reverb: { roomSize: 40, damping: 35, mix: 20 },
  delay: { timeMs: 250, feedback: 25, mix: 18 },
  chorus: { rateHz: 0.8, depthMs: 8, delayMs: 12, feedback: 8, mix: 35 },
  phaser: { rateHz: 0.45, centerHz: 900, depthOct: 1.8, feedback: 35, mix: 45 },
  flanger: { rateHz: 0.28, depthMs: 2, delayMs: 2.5, feedback: 45, mix: 50 },
  compressor: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, makeupDb: 0, mix: 100 },
  lowpass: { cutoffHz: 8000, resonance: 8 },
  highpass: { cutoffHz: 80, resonance: 0 },
  saturator: { drive: 20, mix: 100 },
  distortion: { drive: 55, shape: 35, trimDb: 6, mix: 45 },
  bitcrush: { bits: 8, rate: 50, mix: 35 },
  plugin: { mix: 100 },
};

export function TrackEffectsPanel() {
  const trackId = useUiStore((s) => s.trackEffectsEditorTrackId);
  const close = useUiStore((s) => s.closeTrackEffects);
  const track = useProjectStore((s) => s.project.tracks.find((candidate) => candidate.id === trackId));
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const [addOpen, setAddOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [addRect, setAddRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [position, setPosition] = useState({ x: 280, y: 118 });
  const dragRef = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (trackId && !track) close();
  }, [close, track, trackId]);

  const effects = useMemo(() => track?.effects.filters ?? [], [track?.effects.filters]);

  if (!trackId || !track) return null;

  function updateEffects(filters: TrackEffect[]) {
    if (!track) return;
    updateTrack(track.id, { effects: { ...track.effects, filters } });
  }

  useEffect(() => {
    if (!addOpen) return;
    const rect = addButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAddRect({ left: rect.left, top: rect.bottom - 1, width: rect.width });
  }, [addOpen, position]);

  useEffect(() => {
    if (!addOpen) return;
    function closeAdd(e: MouseEvent) {
      const target = e.target as Element | null;
      if (target?.closest("[data-effects-add]")) return;
      if (target?.closest("[data-floating-layer]")) return;
      setAddOpen(false);
    }
    window.addEventListener("mousedown", closeAdd);
    return () => window.removeEventListener("mousedown", closeAdd);
  }, [addOpen]);

  function addEffect(kind: EffectKind) {
    updateEffects([
      ...effects,
      {
        id: nanoid(),
        kind,
        bypassed: false,
        params: { ...DEFAULT_PARAMS[kind] },
      },
    ]);
    setAddOpen(false);
  }

  function patchEffect(effectId: Id, patch: Partial<TrackEffect>) {
    updateEffects(effects.map((effect) => (
      effect.id === effectId ? { ...effect, ...patch } : effect
    )));
  }

  function patchParam(effect: TrackEffect, key: string, value: number) {
    patchEffect(effect.id, {
      params: {
        ...effect.params,
        [key]: value,
      },
    });
  }

  function removeEffect(effectId: Id) {
    updateEffects(effects.filter((effect) => effect.id !== effectId));
  }

  function startDrag(e: PointerEvent<HTMLElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, input, [role='switch']")) return;
    dragRef.current = {
      dx: e.clientX - position.x,
      dy: e.clientY - position.y,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 240, e.clientX - drag.dx)),
      y: Math.max(48, Math.min(window.innerHeight - 80, e.clientY - drag.dy)),
    });
  }

  function endDrag(e: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  return (
    <section
      className={styles.panel}
      style={{ left: position.x, top: position.y }}
      aria-label={`Effects and filters for ${track.name}`}
    >
      <header
        className={styles.ribbon}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>Effects / Filters</h2>
          <span className={styles.trackName}>{track.name}</span>
          <div className={styles.filterDots} aria-label={`${effects.length} filter${effects.length === 1 ? "" : "s"}`}>
            {effects.map((effect) => (
              <span
                key={effect.id}
                className={`${styles.filterDot} ${effect.bypassed ? styles.filterDotBypassed : ""}`}
                title={EFFECT_LABELS[effect.kind]}
              />
            ))}
          </div>
        </div>
        <HoverInfo content="Close">
          <Button iconOnly size="xs" onClick={close} aria-label="Close effects and filters">
            <Icon name="ph:x" size={14} decorative />
          </Button>
        </HoverInfo>
      </header>

      <div className={styles.body}>
        {effects.length === 0 ? (
          <div className={styles.empty}>No effects yet.</div>
        ) : (
          <div className={styles.chain}>
            {effects.map((effect) => (
              <EffectBlock
                key={effect.id}
                effect={effect}
                onBypass={(bypassed) => patchEffect(effect.id, { bypassed })}
                onParam={(key, value) => patchParam(effect, key, value)}
                onRemove={() => removeEffect(effect.id)}
              />
            ))}
          </div>
        )}

        <div className={styles.addRow} data-effects-add>
          <Button
            ref={addButtonRef}
            size="sm"
            fullWidth
            onClick={() => setAddOpen((open) => !open)}
            aria-label="Add effect"
          >
            <Icon name="ph:plus" size={14} decorative />
            Add effect
          </Button>
        </div>
        {addOpen && addRect && (
          <FloatingLayer
            className={styles.addMenu}
            x={addRect.left}
            y={addRect.top}
            width={addRect.width}
            role="menu"
          >
            {EFFECT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.addOption}
                onClick={() => addEffect(option.value)}
                role="menuitem"
              >
                {option.label}
              </button>
            ))}
          </FloatingLayer>
        )}
      </div>
    </section>
  );
}

function EffectBlock({
  effect,
  onBypass,
  onParam,
  onRemove,
}: {
  effect: TrackEffect;
  onBypass: (bypassed: boolean) => void;
  onParam: (key: string, value: number) => void;
  onRemove: () => void;
}) {
  return (
    <article className={`${styles.effect} ${effect.bypassed ? styles.effectBypassed : ""}`}>
      <div className={styles.effectHeader}>
        <h3 className={styles.effectTitle}>{EFFECT_LABELS[effect.kind]}</h3>
        <Toggle
          checked={!effect.bypassed}
          onChange={(enabled) => onBypass(!enabled)}
        />
        <HoverInfo content="Remove effect">
          <Button iconOnly size="xs" onClick={onRemove} aria-label={`Remove ${EFFECT_LABELS[effect.kind]}`}>
            <Icon name="ph:trash" size={12} decorative />
          </Button>
        </HoverInfo>
      </div>
      <div className={styles.params}>
        {PARAMS[effect.kind].map((param) => (
          <NumberInput
            key={param.key}
            label={param.label}
            value={effect.params[param.key] ?? DEFAULT_PARAMS[effect.kind][param.key] ?? param.min}
            min={param.min}
            max={param.max}
            step={param.step}
            unit={param.unit}
            layout="inline"
            onChange={(value) => onParam(param.key, value)}
          />
        ))}
      </div>
    </article>
  );
}
