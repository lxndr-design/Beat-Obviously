import { Button, NumberInput, Toggle } from "../../../components";
import {
  MODULATION_SOURCE_LABELS,
  MODULATION_TARGET_LABELS,
  useSynthStore,
  type ModulationSourceId,
  type ModulationTargetId,
} from "../../../state/synthStore";
import styles from "./ModulationMatrix.module.css";

const SOURCES = Object.keys(MODULATION_SOURCE_LABELS) as ModulationSourceId[];
const TARGETS = Object.keys(MODULATION_TARGET_LABELS) as ModulationTargetId[];

export function ModulationMatrix() {
  const routes = useSynthStore((state) => state.draft.modulation);
  const updateRoute = useSynthStore((state) => state.updateModulationRoute);
  const addRoute = useSynthStore((state) => state.addModulationRoute);
  const removeRoute = useSynthStore((state) => state.removeModulationRoute);

  return (
    <section className="ds-panel" aria-label="Modulation matrix">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Modulation Matrix</div>
        <div className="ds-panel-actions">
          <Button size="xs" onClick={() => addRoute()}>
            Add
          </Button>
        </div>
      </header>
      <div className={`ds-panel-body ${styles.body}`}>
        <div className={styles.headerRow}>
          <span>On</span>
          <span>Source</span>
          <span>Target</span>
          <span>Amt</span>
          <span>Bi</span>
          <span />
        </div>
        {routes.map((route) => (
          <div key={route.id} className={styles.routeRow}>
            <Toggle checked={route.enabled} onChange={(enabled) => updateRoute(route.id, { enabled })} />
            <select
              className="ds-select"
              value={route.source}
              onChange={(event) => updateRoute(route.id, { source: event.currentTarget.value as ModulationSourceId })}
            >
              {SOURCES.map((source) => (
                <option key={source} value={source}>
                  {MODULATION_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
            <select
              className="ds-select"
              value={route.target}
              onChange={(event) => updateRoute(route.id, { target: event.currentTarget.value as ModulationTargetId })}
            >
              {TARGETS.map((target) => (
                <option key={target} value={target}>
                  {MODULATION_TARGET_LABELS[target]}
                </option>
              ))}
            </select>
            <NumberInput
              value={route.amount}
              min={-1}
              max={1}
              step={0.01}
              layout="inline"
              commitOnChange
              onChange={(amount) => updateRoute(route.id, { amount })}
            />
            <Toggle checked={route.bipolar} onChange={(bipolar) => updateRoute(route.id, { bipolar })} />
            <Button size="xs" variant="ghost" onClick={() => removeRoute(route.id)}>
              Remove
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
