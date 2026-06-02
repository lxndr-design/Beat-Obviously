import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, FloatingLayer, HoverInfo, Icon, Toggle } from "../../../components";
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
  "lfo.1": MACRO_TARGETS,
  "macro.1": MACRO_TARGETS,
  "macro.2": MACRO_TARGETS,
  "macro.3": MACRO_TARGETS,
  "macro.4": MACRO_TARGETS,
};

export function ModulationMatrix() {
  const routes = useSynthStore((state) => state.draft.modulation);
  const updateRoute = useSynthStore((state) => state.updateModulationRoute);
  const addRoute = useSynthStore((state) => state.addModulationRoute);
  const removeRoute = useSynthStore((state) => state.removeModulationRoute);
  const [pickMode, setPickMode] = useState<{
    routeId: string;
    kind: "source" | "target";
    anchor: { x: number; y: number };
    pointer: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    if (!pickMode) return;
    const activePick = pickMode;
    document.body.dataset.synthPickMode = activePick.kind;

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
      const route = routes.find((candidate) => candidate.id === activePick.routeId);
      const value = activePick.kind === "target"
        ? target?.closest<HTMLElement>("[data-synth-target-id]")?.dataset.synthTargetId
        : target?.closest<HTMLElement>("[data-synth-source-id]")?.dataset.synthSourceId;

      event.preventDefault();
      event.stopPropagation();

      if (route && activePick.kind === "target" && isModulationTarget(value)) {
        const targets = targetsForSource(route.source);
        if (targets.includes(value)) updateRoute(route.id, { target: value });
      } else if (route && activePick.kind === "source" && isModulationSource(value)) {
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
    return () => {
      delete document.body.dataset.synthPickMode;
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [pickMode, routes, updateRoute]);

  function startPick(routeId: string, kind: "source" | "target", event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setPickMode({ routeId, kind, anchor, pointer: anchor });
  }

  return (
    <section className="ds-panel" aria-label="Modulation matrix">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Modulation Matrix</div>
        <div className="ds-panel-actions">
          <Button size="xs" onClick={() => addRoute()}>
            <Icon name="ph:plus" size={12} decorative />
            Add
          </Button>
        </div>
      </header>
      <div className={`ds-panel-body ${styles.body}`}>
        <div className={styles.headerRow}>
          <span>On</span>
          <span>Source</span>
          <span />
          <span>Target</span>
          <span />
          <span>Strength</span>
          <span>Polarity</span>
          <span />
        </div>
        {routes.map((route) => {
          const targets = targetsForSource(route.source);
          const selectedTarget = targets.includes(route.target) ? route.target : targets[0];
          return (
            <div key={route.id} className={styles.routeRow}>
              <div className={styles.onCell}>
                <Toggle checked={route.enabled} onChange={(enabled) => updateRoute(route.id, { enabled })} />
              </div>
              <div className={styles.sourceCell}>
                <select
                  className={`ds-select ${styles.routeSelect} ${styles.sourceSelect}`}
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
                  {SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {MODULATION_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
              </div>
              <HoverInfo content="Pick source">
                <Button
                  className={styles.pickButton}
                  iconOnly
                  size="xs"
                  selected={pickMode?.routeId === route.id && pickMode.kind === "source"}
                  aria-label="Pick modulation source"
                  onPointerDown={(event) => startPick(route.id, "source", event)}
                >
                  <Icon name="ph:plug" size={12} decorative />
                </Button>
              </HoverInfo>
              <TargetSelect
                value={selectedTarget}
                targets={targets}
                onChange={(target) => updateRoute(route.id, { target })}
              />
              <HoverInfo content="Pick target">
                <Button
                  className={styles.pickButton}
                  iconOnly
                  size="xs"
                  selected={pickMode?.routeId === route.id && pickMode.kind === "target"}
                  aria-label="Pick modulation target"
                  onPointerDown={(event) => startPick(route.id, "target", event)}
                >
                  <Icon name="ph:plug" size={12} decorative />
                </Button>
              </HoverInfo>
              <label className={styles.strengthSlider} aria-label="Strength">
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
              <div className={styles.modeCell}>
                {route.source === "lfo.1" ? (
                  <HoverInfo content={route.bipolar ? "LFO swings below and above the target value." : "LFO only pushes the target upward."}>
                    <button
                      type="button"
                      className={`${styles.modeButton} ${route.bipolar ? styles.modeButtonActive : ""}`}
                      aria-pressed={route.bipolar}
                      aria-label="Toggle bipolar LFO modulation"
                      onClick={() => updateRoute(route.id, { bipolar: !route.bipolar })}
                    >
                      {route.bipolar ? "±" : "+"}
                    </button>
                  </HoverInfo>
                ) : (
                  <span className={styles.modeStatic} aria-label="Polarity only applies to LFO routes">
                    -
                  </span>
                )}
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
        })}
      </div>
      {pickMode && <PickerCable anchor={pickMode.anchor} pointer={pickMode.pointer} kind={pickMode.kind} />}
    </section>
  );
}

function PickerCable({
  anchor,
  pointer,
  kind,
}: {
  anchor: { x: number; y: number };
  pointer: { x: number; y: number };
  kind: "source" | "target";
}) {
  const minX = Math.min(anchor.x, pointer.x);
  const minY = Math.min(anchor.y, pointer.y);
  const width = Math.max(1, Math.abs(pointer.x - anchor.x));
  const height = Math.max(1, Math.abs(pointer.y - anchor.y));
  const x1 = anchor.x - minX;
  const y1 = anchor.y - minY;
  const x2 = pointer.x - minX;
  const y2 = pointer.y - minY;
  const curve = Math.max(24, Math.abs(x2 - x1) * 0.45);

  return createPortal(
    <div className={styles.pickOverlay} aria-label={`Picking modulation ${kind}`}>
      <svg
        className={styles.pickCable}
        style={{
          left: minX,
          top: minY,
          width,
          height,
        }}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`} />
      </svg>
      <span className={styles.pickPlug} style={{ left: pointer.x, top: pointer.y }} />
    </div>,
    document.body,
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

function TargetSelect({
  value,
  targets,
  onChange,
}: {
  value: ModulationTargetId;
  targets: ModulationTargetId[];
  onChange: (value: ModulationTargetId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const selected = targetLabelParts(value);

  useEffect(() => {
    if (!open) return;
    function position() {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const menuWidth = 196;
      const estimatedHeight = Math.min(320, Math.max(28, targets.length * 28));
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
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target))
        setOpen(false);
    }

    position();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, targets.length]);

  return (
    <div ref={ref} className={styles.targetMenu}>
      <button
        type="button"
        className={styles.targetTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <TargetLabel prefix={selected.prefix} name={selected.name} />
        <Icon name="ph:caret-down" size={12} decorative />
      </button>
      {open && menuRect && createPortal(
        <FloatingLayer
          ref={menuRef}
          className={styles.targetOptions}
          role="listbox"
          x={menuRect.left}
          y={menuRect.top}
          width={menuRect.width}
          style={{ maxHeight: menuRect.maxHeight }}
        >
          {targets.map((target) => {
            const parts = targetLabelParts(target);
            return (
              <button
                key={target}
                type="button"
                role="option"
                aria-selected={target === value}
                className={`${styles.targetOption} ${target === value ? styles.targetOptionSelected : ""}`}
                onClick={() => {
                  onChange(target);
                  setOpen(false);
                }}
              >
                <TargetLabel prefix={parts.prefix} name={parts.name} />
              </button>
            );
          })}
        </FloatingLayer>,
        document.body,
      )}
    </div>
  );
}

function TargetLabel({ prefix, name }: { prefix: string; name: string }) {
  return (
    <span className={styles.targetLabel}>
      <span className={styles.targetPrefix}>{prefix}</span>
      <span className={styles.targetDivider}>|</span>
      <span className={styles.targetName}>{name}</span>
    </span>
  );
}

function targetLabelParts(target: ModulationTargetId): { prefix: string; name: string } {
  const label = MODULATION_TARGET_LABELS[target] ?? target;
  const match = /^(OSC [AB]|Filter|Amp|Unison) (.+)$/.exec(label);
  if (!match) return { prefix: "Mod", name: label };
  return { prefix: match[1], name: match[2] };
}
