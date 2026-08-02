import { createMemo, For, Show, type JSX } from "solid-js";
import { Button, FloatingSelect, Icon, Slider, StatusChip, Toggle } from "../../solid-ui";
import {
  AURUM_MODULATION_MAX_ROUTES,
  AURUM_MODULATION_SOURCES,
  AURUM_MODULATION_TARGETS,
  aurumModulationTargetLabel,
  aurumOperatorModulationTarget,
  normalizeAurumModulationRoutes,
} from "../../state/aurum";
import {
  MODULATION_SOURCE_LABELS,
  MODULATION_TARGET_LABELS,
} from "../../state/synthStore";
import type { SynthExpressionActivity } from "../../state/synthStore";
import type { AurumSynthConfig, Instrument, ModulationRemapCurve, SharedModulationRoute } from "../../state/types";
import styles from "./AurumModulationBridge.module.css";

const SHARED_SOURCE_LABELS = MODULATION_SOURCE_LABELS as Readonly<Record<string, string>>;
const SHARED_TARGET_LABELS = MODULATION_TARGET_LABELS as Readonly<Record<string, string>>;

const SOURCE_OPTIONS = AURUM_MODULATION_SOURCES.map((value) => ({
  value,
  label: MODULATION_SOURCE_LABELS[value],
}));
const LFO_SHAPES = ["sine", "triangle", "saw", "square"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));
const SYNC_RATES = ["1/2", "1/4", "1/8", "1/16"].map((value) => ({ value, label: value }));
const REMAP_CURVES = [
  { value: "linear", label: "Linear" },
  { value: "ease-in", label: "Ease In" },
  { value: "ease-out", label: "Ease Out" },
  { value: "s-curve", label: "S-Curve" },
];

export interface AurumModulationBridgeProps {
  instrument: Instrument;
  config: AurumSynthConfig;
  selectedOperator: number;
  expressionActivity?: SynthExpressionActivity | null;
  onInstrumentPatch: (patch: Partial<Instrument>, group: string) => void;
  onConfigChange: (config: AurumSynthConfig, group: string) => void;
}

export function AurumModulationBridge(props: AurumModulationBridgeProps) {
  const routes = () => props.config.modulation;
  const liveExpressionLabel = createMemo(() => {
    const activity = props.expressionActivity;
    if (!activity) return null;
    const values = [
      ["Pressure", activity.pressure],
      ["Mod", activity.modWheel],
      ["Timbre", activity.timbre],
    ] as const;
    const active = values.filter(([, value]) => Number.isFinite(value));
    if (active.length === 0) return null;
    return active.map(([label, value]) => `${label} ${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}%`).join(" · ");
  });
  const targetOptions = createMemo(() => {
    const selectedTargets = [
      aurumOperatorModulationTarget(props.selectedOperator, "level"),
      aurumOperatorModulationTarget(props.selectedOperator, "pan"),
    ];
    const ordered = [...selectedTargets, ...AURUM_MODULATION_TARGETS.filter((target) => !selectedTargets.includes(target))];
    return ordered.map((value) => ({
      value,
      label: SHARED_TARGET_LABELS[value] ?? aurumModulationTargetLabel(value),
    }));
  });

  function commitRoutes(next: SharedModulationRoute[], group: string) {
    props.onConfigChange({
      ...props.config,
      modulation: normalizeAurumModulationRoutes(next),
    }, group);
  }

  function addRoute() {
    if (routes().length >= AURUM_MODULATION_MAX_ROUTES) return;
    const used = new Set(routes().map((route) => route.id));
    let suffix = routes().length + 1;
    while (used.has(`aurum-mod-${suffix}`)) suffix += 1;
    commitRoutes([...routes(), {
      id: `aurum-mod-${suffix}`,
      source: "lfo.1",
      target: aurumOperatorModulationTarget(props.selectedOperator, "level"),
      amount: 0.25,
      bipolar: true,
      enabled: true,
      curve: "linear",
    }], "modulation:add");
  }

  function updateRoute(id: string, patch: Partial<SharedModulationRoute>) {
    commitRoutes(
      routes().map((route) => route.id === id ? { ...route, ...patch } : route),
      `modulation:${id}:${Object.keys(patch).sort().join(",")}`,
    );
  }

  function removeRoute(id: string) {
    commitRoutes(routes().filter((route) => route.id !== id), `modulation:${id}:remove`);
  }

  function setMacro(indexToSet: number, value: number) {
    const macroValues = Array.from({ length: 8 }, (_, index) => index === indexToSet
      ? value
      : props.config.macroValues[index] ?? 0);
    props.onConfigChange({ ...props.config, macroValues }, `modulation:macro.${indexToSet + 1}`);
  }

  return (
    <section class={styles.bridge} aria-label="Aurum shared modulation">
      <div class={styles.header}>
        <div>
          <h4>Shared modulation</h4>
          <p>Shared sources can drive master, operator, and Filter A/B controls with a per-route response curve.</p>
          <Show when={liveExpressionLabel()}>
            <StatusChip tone="muted" title="Captured when browser audition starts">Live input · {liveExpressionLabel()}</StatusChip>
          </Show>
        </div>
        <Button size="xs" onClick={addRoute} disabled={routes().length >= AURUM_MODULATION_MAX_ROUTES}>
          <Icon name="ph:plus" size={18} decorative />
          Add route
        </Button>
      </div>

      <div class={styles.sourceGrid}>
        <FloatingSelect
          label="LFO 1 shape"
          layout="inline"
          value={props.instrument.lfoWaveform ?? "sine"}
          options={LFO_SHAPES}
          onChange={(lfoWaveform) => props.onInstrumentPatch({
            lfoWaveform: lfoWaveform as NonNullable<Instrument["lfoWaveform"]>,
          }, "modulation:lfo.1:shape")}
        />
        <Toggle
          label="Tempo sync"
          checked={props.instrument.lfoSync ?? false}
          onChange={(lfoSync) => props.onInstrumentPatch({ lfoSync }, "modulation:lfo.1:sync")}
        />
        <Show
          when={props.instrument.lfoSync}
          fallback={
            <Slider
              label="LFO 1 rate"
              layout="inline"
              min={0.05}
              max={20}
              step={0.05}
              value={props.instrument.lfoRateHz ?? 4}
              readout={<span>{(props.instrument.lfoRateHz ?? 4).toFixed(2)} Hz</span>}
              onChange={(lfoRateHz) => props.onInstrumentPatch({ lfoRateHz }, "modulation:lfo.1:rate")}
            />
          }
        >
          <FloatingSelect
            label="LFO 1 rate"
            layout="inline"
            value={props.instrument.lfoSyncedRate ?? "1/4"}
            options={SYNC_RATES}
            onChange={(lfoSyncedRate) => props.onInstrumentPatch({ lfoSyncedRate }, "modulation:lfo.1:rate")}
          />
        </Show>
        <Slider
          label="Macro 1"
          layout="inline"
          min={0}
          max={1}
          step={0.01}
          value={props.config.macroValues[0] ?? 0}
          readout={<span>{Math.round((props.config.macroValues[0] ?? 0) * 100)}%</span>}
          onChange={(value) => setMacro(0, value)}
        />
        <Slider
          label="Macro 2"
          layout="inline"
          min={0}
          max={1}
          step={0.01}
          value={props.config.macroValues[1] ?? 0}
          readout={<span>{Math.round((props.config.macroValues[1] ?? 0) * 100)}%</span>}
          onChange={(value) => setMacro(1, value)}
        />
      </div>

      <Show when={routes().length > 0} fallback={<p class={styles.empty}>No shared modulation routes.</p>}>
        <div class={styles.routeHeader} aria-hidden="true">
          <span>On</span>
          <span>Source</span>
          <span>Destination</span>
          <span>Amount</span>
          <span>Curve</span>
          <span>Mode</span>
          <span />
        </div>
        <For each={routes().map((route) => route.id)}>{(routeId, index) => {
          const route = () => routes().find((candidate) => candidate.id === routeId)!;
          return (
            <div class={styles.route} aria-label={`Aurum modulation route ${index() + 1}`}>
              <Toggle
                aria-label={`Aurum route ${index() + 1} enabled`}
                checked={route().enabled}
                onChange={(enabled) => updateRoute(routeId, { enabled })}
              />
              <FloatingSelect
                layout="bare"
                value={route().source}
                ariaLabel={`Aurum route ${index() + 1} source`}
                options={SOURCE_OPTIONS}
                onChange={(source) => updateRoute(routeId, { source })}
              />
              <FloatingSelect
                layout="bare"
                value={route().target}
                ariaLabel={`Aurum route ${index() + 1} destination`}
                options={targetOptions()}
                onChange={(target) => updateRoute(routeId, { target })}
              />
              <Slider
                layout="bare"
                min={-1}
                max={1}
                step={0.01}
                value={route().amount}
                ariaLabel={`Aurum route ${index() + 1} amount`}
                readout={<span>{Math.round(route().amount * 100)}%</span>}
                onChange={(amount) => updateRoute(routeId, { amount })}
              />
              <FloatingSelect
                layout="bare"
                value={route().curve ?? "linear"}
                ariaLabel={`Aurum route ${index() + 1} response curve`}
                options={REMAP_CURVES}
                onChange={(curve) => updateRoute(routeId, { curve: curve as ModulationRemapCurve })}
              />
              <Button
                size="xs"
                variant="ghost"
                selected={route().bipolar}
                aria-pressed={route().bipolar}
                aria-label={`Aurum route ${index() + 1} bipolar`}
                onClick={() => updateRoute(routeId, { bipolar: !route().bipolar })}
              >
                {route().bipolar ? "+/-" : "+"}
              </Button>
              <Button
                iconOnly
                size="xs"
                variant="ghost"
                aria-label={`Remove Aurum route ${index() + 1}`}
                onClick={() => removeRoute(routeId)}
              >
                <Icon name="ph:trash" size={18} decorative />
              </Button>
            </div>
          );
        }}</For>
      </Show>
    </section>
  );
}

export function AurumModulatedControl(props: {
  routes: SharedModulationRoute[];
  target: string;
  children: JSX.Element;
}) {
  const activeRoutes = createMemo(() => props.routes.filter((route) => route.enabled && route.target === props.target));
  const details = createMemo(() => activeRoutes().map((route) => {
    const source = SHARED_SOURCE_LABELS[route.source] ?? route.source;
    const amount = `${route.amount >= 0 ? "+" : ""}${Math.round(route.amount * 100)}%`;
    return `${source} ${amount}`;
  }));
  const total = createMemo(() => activeRoutes().reduce((sum, route) => sum + route.amount, 0));
  const compact = createMemo(() => activeRoutes().length === 1
    ? details()[0]
    : `${activeRoutes().length} routes Σ${total() >= 0 ? "+" : ""}${Math.round(total() * 100)}%`);

  return (
    <div class={styles.modulatedControl}>
      {props.children}
      <Show when={activeRoutes().length > 0}>
        <StatusChip tone="muted" title={details().join(", ")} aria-label={`${aurumModulationTargetLabel(props.target)} modulation: ${details().join(", ")}`}>
          {compact()}
        </StatusChip>
      </Show>
    </div>
  );
}
