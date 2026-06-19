import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Button, HoverInfo, Icon, Toggle } from "../../../solid-ui";
import { createStoreSelector } from "../../../solid-utils/store";
import {
  MODULATION_SOURCE_LABELS,
  MODULATION_TARGET_LABELS,
  useSynthStore,
  type ModulationSourceId,
  type ModulationTargetId,
} from "../../../state/synthStore";
import styles from "./ModulationMatrix.module.css";

const SOURCES = Object.keys(MODULATION_SOURCE_LABELS) as ModulationSourceId[];
const MACRO_TARGETS = Object.keys(MODULATION_TARGET_LABELS) as ModulationTargetId[];
const TARGETS_BY_SOURCE: Record<ModulationSourceId, ModulationTargetId[]> = {
  "env.1": MACRO_TARGETS,
  "env.2": MACRO_TARGETS,
  "lfo.1": MACRO_TARGETS,
  "lfo.2": MACRO_TARGETS,
  velocity: MACRO_TARGETS,
  keytrack: MACRO_TARGETS,
  "macro.1": MACRO_TARGETS,
  "macro.2": MACRO_TARGETS,
  "macro.3": MACRO_TARGETS,
  "macro.4": MACRO_TARGETS,
};

type PickMode = {
  routeId: string;
  kind: "source" | "target";
  anchor: { x: number; y: number };
  pointer: { x: number; y: number };
};

export function ModulationMatrix() {
  const routes = createStoreSelector(useSynthStore, (state) => state.draft.modulation);
  const updateRoute = useSynthStore.getState().updateModulationRoute;
  const addRoute = useSynthStore.getState().addModulationRoute;
  const removeRoute = useSynthStore.getState().removeModulationRoute;
  const [pickMode, setPickMode] = createSignal<PickMode | null>(null);

  createEffect(() => {
    const activePick = pickMode();
    if (!activePick) return;
    const pick: PickMode = activePick;
    document.body.dataset.synthPickMode = pick.kind;

    function close() {
      setPickMode(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }

    function onPointerMove(event: PointerEvent) {
      setPickMode((current) => current ? { ...current, pointer: { x: event.clientX, y: event.clientY } } : current);
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      const route = routes().find((candidate) => candidate.id === pick.routeId);
      const value = pick.kind === "target"
        ? target?.closest<HTMLElement>("[data-synth-target-id]")?.dataset.synthTargetId
        : target?.closest<HTMLElement>("[data-synth-source-id]")?.dataset.synthSourceId;

      event.preventDefault();
      event.stopPropagation();

      if (route && pick.kind === "target" && isModulationTarget(value)) {
        const targets = targetsForSource(route.source);
        if (targets.includes(value)) updateRoute(route.id, { target: value });
      } else if (route && pick.kind === "source" && isModulationSource(value)) {
        const nextTargets = targetsForSource(value);
        updateRoute(route.id, {
          source: value,
          target: nextTargets.includes(route.target) ? route.target : nextTargets[0],
        });
      }

      close();
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    onCleanup(() => {
      delete document.body.dataset.synthPickMode;
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    });
  });

  function startPick(routeId: string, kind: "source" | "target", event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setPickMode({ routeId, kind, anchor, pointer: anchor });
  }

  return (
    <section class="ds-panel" aria-label="Modulation matrix">
      <header class="ds-panel-header">
        <div class="ds-panel-title">Modulation Matrix</div>
        <div class="ds-panel-actions">
          <Button size="xs" onClick={() => addRoute()}>
            <Icon name="ph:plus" size={12} decorative />
            Add
          </Button>
        </div>
      </header>
      <div class={`ds-panel-body ${styles.body}`}>
        <div class={styles.headerRow}>
          <span>On</span>
          <span>Source</span>
          <span />
          <span>Target</span>
          <span />
          <span>Strength</span>
          <span>Polarity</span>
          <span />
        </div>
        <For each={routes()}>
          {(route) => {
            const targets = () => targetsForSource(route.source);
            const selectedTarget = () => targets().includes(route.target) ? route.target : targets()[0];
            return (
              <div class={styles.routeRow}>
                <div class={styles.onCell}>
                  <Toggle checked={route.enabled} onChange={(enabled) => updateRoute(route.id, { enabled })} />
                </div>
                <div class={styles.sourceCell}>
                  <select
                    class={`ds-select ${styles.routeSelect} ${styles.sourceSelect}`}
                    value={route.source}
                    onChange={(event) => {
                      const source = event.currentTarget.value as ModulationSourceId;
                      const nextTargets = targetsForSource(source);
                      updateRoute(route.id, {
                        source,
                        target: nextTargets.includes(route.target) ? route.target : nextTargets[0],
                      });
                    }}
                  >
                    <For each={SOURCES}>
                      {(source) => (
                        <option value={source}>
                          {MODULATION_SOURCE_LABELS[source]}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <HoverInfo content="Pick source">
                  <Button
                    className={styles.pickButton}
                    iconOnly
                    size="xs"
                    selected={pickMode()?.routeId === route.id && pickMode()?.kind === "source"}
                    aria-label="Pick modulation source"
                    onPointerDown={(event) => startPick(route.id, "source", event)}
                  >
                    <Icon name="ph:plug" size={12} decorative />
                  </Button>
                </HoverInfo>
                <TargetSelect
                  value={selectedTarget()}
                  targets={targets()}
                  onChange={(target) => updateRoute(route.id, { target })}
                />
                <HoverInfo content="Pick target">
                  <Button
                    className={styles.pickButton}
                    iconOnly
                    size="xs"
                    selected={pickMode()?.routeId === route.id && pickMode()?.kind === "target"}
                    aria-label="Pick modulation target"
                    onPointerDown={(event) => startPick(route.id, "target", event)}
                  >
                    <Icon name="ph:plug" size={12} decorative />
                  </Button>
                </HoverInfo>
                <label class={styles.strengthSlider} aria-label="Strength">
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={route.amount}
                    onChange={(event) => updateRoute(route.id, { amount: Number(event.currentTarget.value) })}
                  />
                  <span>{formatStrength(route.amount)}</span>
                </label>
                <div class={styles.modeCell}>
                  <Show
                    when={route.source === "lfo.1" || route.source === "lfo.2"}
                    fallback={<span class={styles.modeStatic} aria-label="Polarity only applies to LFO routes">-</span>}
                  >
                    <HoverInfo content={route.bipolar ? "LFO swings below and above the target value." : "LFO only pushes the target upward."}>
                      <button
                        type="button"
                        class={`${styles.modeButton} ${route.bipolar ? styles.modeButtonActive : ""}`}
                        aria-pressed={route.bipolar}
                        aria-label="Toggle bipolar LFO modulation"
                        onClick={() => updateRoute(route.id, { bipolar: !route.bipolar })}
                      >
                        {route.bipolar ? "+/-" : "+"}
                      </button>
                    </HoverInfo>
                  </Show>
                </div>
                <HoverInfo content="Remove route">
                  <Button
                    className={styles.removeButton}
                    iconOnly
                    size="xs"
                    variant="ghost"
                    aria-label="Remove modulation route"
                    onClick={() => removeRoute(route.id)}
                  >
                    <Icon name="ph:trash" size={12} decorative />
                  </Button>
                </HoverInfo>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={pickMode()}>
        {(mode) => <PickerCable anchor={mode().anchor} pointer={mode().pointer} kind={mode().kind} />}
      </Show>
    </section>
  );
}

function PickerCable(props: {
  anchor: { x: number; y: number };
  pointer: { x: number; y: number };
  kind: "source" | "target";
}) {
  const minX = () => Math.min(props.anchor.x, props.pointer.x);
  const minY = () => Math.min(props.anchor.y, props.pointer.y);
  const width = () => Math.max(1, Math.abs(props.pointer.x - props.anchor.x));
  const height = () => Math.max(1, Math.abs(props.pointer.y - props.anchor.y));
  const x1 = () => props.anchor.x - minX();
  const y1 = () => props.anchor.y - minY();
  const x2 = () => props.pointer.x - minX();
  const y2 = () => props.pointer.y - minY();
  const curve = () => Math.max(24, Math.abs(x2() - x1()) * 0.45);

  return (
    <Portal mount={document.body}>
      <div class={styles.pickOverlay} aria-label={`Picking modulation ${props.kind}`}>
        <svg
          class={styles.pickCable}
          style={{
            left: `${minX()}px`,
            top: `${minY()}px`,
            width: `${width()}px`,
            height: `${height()}px`,
          }}
          viewBox={`0 0 ${width()} ${height()}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={`M ${x1()} ${y1()} C ${x1() + curve()} ${y1()}, ${x2() - curve()} ${y2()}, ${x2()} ${y2()}`} />
        </svg>
        <span class={styles.pickPlug} style={{ left: `${props.pointer.x}px`, top: `${props.pointer.y}px` }} />
      </div>
    </Portal>
  );
}

function TargetSelect(props: {
  value: ModulationTargetId;
  targets: ModulationTargetId[];
  onChange: (value: ModulationTargetId) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [menuRect, setMenuRect] = createSignal<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  let triggerRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  const selected = () => targetLabelParts(props.value);

  createEffect(() => {
    if (!open()) return;

    function position() {
      const rect = triggerRef?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const menuWidth = 196;
      const estimatedHeight = Math.min(320, Math.max(28, props.targets.length * 28));
      const availableBelow = window.innerHeight - rect.bottom - margin;
      const availableAbove = rect.top - margin;
      const openBelow = availableBelow >= Math.min(estimatedHeight, 160) || availableBelow >= availableAbove;
      const maxHeight = Math.max(96, Math.min(estimatedHeight, openBelow ? availableBelow : availableAbove));
      const top = openBelow ? rect.bottom - 1 : Math.max(margin, rect.top - maxHeight + 1);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin));
      setMenuRect({ left, top, width: menuWidth, maxHeight });
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef?.contains(target) && !menuRef?.contains(target)) setOpen(false);
    }

    position();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    });
  });

  return (
    <div ref={triggerRef} class={styles.targetMenu}>
      <button
        type="button"
        class={styles.targetTrigger}
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <TargetLabel prefix={selected().prefix} name={selected().name} />
        <Icon name="ph:caret-down" size={12} decorative />
      </button>
      <Show when={open() && menuRect()}>
        {(rect) => (
          <FloatingLayer
            ref={(element) => {
              menuRef = element;
            }}
            className={styles.targetOptions}
            role="listbox"
            x={rect().left}
            y={rect().top}
            width={rect().width}
            style={{ "max-height": `${rect().maxHeight}px` }}
          >
            <For each={props.targets}>
              {(target) => {
                const parts = targetLabelParts(target);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={target === props.value}
                    class={`${styles.targetOption} ${target === props.value ? styles.targetOptionSelected : ""}`}
                    onClick={() => {
                      props.onChange(target);
                      setOpen(false);
                    }}
                  >
                    <TargetLabel prefix={parts.prefix} name={parts.name} />
                  </button>
                );
              }}
            </For>
          </FloatingLayer>
        )}
      </Show>
    </div>
  );
}

function FloatingLayer(props: {
  ref?: (element: HTMLDivElement) => void;
  className?: string;
  role?: "listbox";
  x: number;
  y: number;
  width: number;
  style?: JSX.CSSProperties;
  children: JSX.Element;
}) {
  return (
    <Portal mount={document.body}>
      <div
        ref={props.ref}
        class={props.className}
        role={props.role}
        data-floating-layer
        style={{
          position: "fixed",
          left: `${props.x}px`,
          top: `${props.y}px`,
          width: `${props.width}px`,
          "z-index": "4200",
          ...props.style,
        }}
      >
        {props.children}
      </div>
    </Portal>
  );
}

function TargetLabel(props: { prefix: string; name: string }) {
  return (
    <span class={styles.targetLabel}>
      <span class={styles.targetPrefix}>{props.prefix}</span>
      <span class={styles.targetDivider}>|</span>
      <span class={styles.targetName}>{props.name}</span>
    </span>
  );
}

function targetsForSource(source: ModulationSourceId): ModulationTargetId[] {
  return TARGETS_BY_SOURCE[source] ?? MACRO_TARGETS;
}

function isModulationTarget(value: string | undefined): value is ModulationTargetId {
  return Boolean(value && MACRO_TARGETS.includes(value as ModulationTargetId));
}

function isModulationSource(value: string | undefined): value is ModulationSourceId {
  return Boolean(value && SOURCES.includes(value as ModulationSourceId));
}

function formatStrength(value: number): string {
  const rounded = Math.round(value * 100);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function targetLabelParts(target: ModulationTargetId): { prefix: string; name: string } {
  const label = MODULATION_TARGET_LABELS[target] ?? target;
  const match = /^(OSC [AB]|Filter|Amp|Unison) (.+)$/.exec(label);
  if (!match) return { prefix: "Mod", name: label };
  return { prefix: match[1], name: match[2] };
}
