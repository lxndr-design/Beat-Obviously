import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Button, HoverInfo, Icon, NumberInput, Toggle } from "../../solid-ui";
import { useProjectStore, useUiStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import { createTrackEffect, EFFECT_DEFAULT_PARAMS, EFFECT_LABELS, EFFECT_OPTIONS, EFFECT_PARAM_SPECS, type EffectKind } from "../../state/effects";
import type { Id, Track } from "../../state/types";
import styles from "./TrackEffectsPanel.module.css";

type TrackEffect = Track["effects"]["filters"][number];

interface DragState {
  dx: number;
  dy: number;
  pointerId: number;
}

export function TrackEffectsPanel() {
  let addButtonRef: HTMLButtonElement | undefined;
  let dragRef: DragState | null = null;
  const trackId = createStoreSelector(useUiStore, (s) => s.trackEffectsEditorTrackId);
  const tracks = createStoreSelector(useProjectStore, (s) => s.project.tracks);
  const track = createMemo(() => tracks().find((candidate) => candidate.id === trackId()));
  const effects = createMemo(() => track()?.effects.filters ?? []);
  const [addOpen, setAddOpen] = createSignal(false);
  const [addRect, setAddRect] = createSignal<{ left: number; top: number; width: number } | null>(null);
  const [position, setPosition] = createSignal({ x: 280, y: 118 });

  createEffect(() => {
    if (trackId() && !track()) useUiStore.getState().closeTrackEffects();
  });

  createEffect(() => {
    if (!addOpen()) return;
    const rect = addButtonRef?.getBoundingClientRect();
    if (!rect) return;
    const currentPosition = position();
    setAddRect({ left: rect.left, top: rect.bottom - 1, width: rect.width });
    void currentPosition;
  });

  createEffect(() => {
    if (!addOpen()) return;
    function closeAdd(event: MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest("[data-effects-add]")) return;
      if (target?.closest("[data-floating-layer]")) return;
      setAddOpen(false);
    }
    window.addEventListener("mousedown", closeAdd);
    onCleanup(() => window.removeEventListener("mousedown", closeAdd));
  });

  function updateEffects(filters: TrackEffect[]) {
    const currentTrack = track();
    if (!currentTrack) return;
    useProjectStore.getState().updateTrack(currentTrack.id, { effects: { ...currentTrack.effects, filters } });
  }

  function addEffect(kind: EffectKind) {
    updateEffects([
      ...effects(),
      createTrackEffect(kind),
    ]);
    setAddOpen(false);
  }

  function patchEffect(effectId: Id, patch: Partial<TrackEffect>) {
    updateEffects(effects().map((effect) => (
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
    updateEffects(effects().filter((effect) => effect.id !== effectId));
  }

  function startDrag(event: PointerEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, [role='switch']")) return;
    const currentPosition = position();
    dragRef = {
      dx: event.clientX - currentPosition.x,
      dy: event.clientY - currentPosition.y,
      pointerId: event.pointerId,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    const drag = dragRef;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 240, event.clientX - drag.dx)),
      y: Math.max(48, Math.min(window.innerHeight - 80, event.clientY - drag.dy)),
    });
  }

  function endDrag(event: PointerEvent) {
    if (dragRef?.pointerId === event.pointerId) dragRef = null;
  }

  return (
    <Show when={track()}>
      {(currentTrack) => (
        <section
          class={styles.panel}
          style={{ left: `${position().x}px`, top: `${position().y}px` }}
          aria-label={`Effects and filters for ${currentTrack().name}`}
        >
          <header
            class={styles.ribbon}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div class={styles.titleBlock}>
              <h2 class={styles.title}>Effects / Filters</h2>
              <span class={styles.trackName}>{currentTrack().name}</span>
              <div class={styles.filterDots} aria-label={`${effects().length} filter${effects().length === 1 ? "" : "s"}`}>
                <For each={effects()}>
                  {(effect) => (
                    <span
                      class={`${styles.filterDot} ${effect.bypassed ? styles.filterDotBypassed : ""}`}
                      title={EFFECT_LABELS[effect.kind]}
                    />
                  )}
                </For>
              </div>
            </div>
            <HoverInfo content="Close">
              <Button iconOnly size="xs" onClick={() => useUiStore.getState().closeTrackEffects()} aria-label="Close effects and filters">
                <Icon name="ph:x" size={14} decorative />
              </Button>
            </HoverInfo>
          </header>

          <div class={styles.body}>
            <Show when={effects().length > 0} fallback={<div class={styles.empty}>No effects yet.</div>}>
              <div class={styles.chain}>
                <For each={effects()}>
                  {(effect) => (
                    <EffectBlock
                      effect={effect}
                      onBypass={(bypassed) => patchEffect(effect.id, { bypassed })}
                      onParam={(key, value) => patchParam(effect, key, value)}
                      onRemove={() => removeEffect(effect.id)}
                    />
                  )}
                </For>
              </div>
            </Show>

            <div class={styles.addRow} data-effects-add>
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
            <Show when={addOpen() && addRect()}>
              {(rect) => (
                <FloatingLayer
                  className={styles.addMenu}
                  x={rect().left}
                  y={rect().top}
                  width={rect().width}
                  role="menu"
                >
                  <For each={EFFECT_OPTIONS}>
                    {(option) => (
                      <button
                        type="button"
                        class={styles.addOption}
                        onClick={() => addEffect(option.value)}
                        role="menuitem"
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                </FloatingLayer>
              )}
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}

function EffectBlock(props: {
  effect: TrackEffect;
  onBypass: (bypassed: boolean) => void;
  onParam: (key: string, value: number) => void;
  onRemove: () => void;
}) {
  return (
    <article class={`${styles.effect} ${props.effect.bypassed ? styles.effectBypassed : ""}`}>
      <div class={styles.effectHeader}>
        <h3 class={styles.effectTitle}>{EFFECT_LABELS[props.effect.kind]}</h3>
        <Toggle
          checked={!props.effect.bypassed}
          onChange={(enabled) => props.onBypass(!enabled)}
        />
        <HoverInfo content="Remove effect">
          <Button iconOnly size="xs" onClick={props.onRemove} aria-label={`Remove ${EFFECT_LABELS[props.effect.kind]}`}>
            <Icon name="ph:trash" size={12} decorative />
          </Button>
        </HoverInfo>
      </div>
      <div class={styles.params}>
        <For each={EFFECT_PARAM_SPECS[props.effect.kind]}>
          {(param) => (
            <NumberInput
              label={param.label}
              value={props.effect.params[param.key] ?? EFFECT_DEFAULT_PARAMS[props.effect.kind][param.key] ?? param.min}
              min={param.min}
              max={param.max}
              step={param.step}
              unit={param.unit}
              layout="inline"
              onChange={(value) => props.onParam(param.key, value)}
            />
          )}
        </For>
      </div>
    </article>
  );
}

function FloatingLayer(props: {
  className?: string;
  x: number;
  y: number;
  width?: number;
  role?: "menu";
  children: JSX.Element;
}) {
  return (
    <Portal mount={document.body}>
      <div
        class={props.className}
        style={{
          position: "fixed",
          left: `${props.x}px`,
          top: `${props.y}px`,
          width: props.width === undefined ? undefined : `${props.width}px`,
          "z-index": "4200",
        }}
        role={props.role}
        data-floating-layer
      >
        {props.children}
      </div>
    </Portal>
  );
}
