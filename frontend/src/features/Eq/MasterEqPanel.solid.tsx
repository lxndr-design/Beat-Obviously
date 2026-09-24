import { createMemo, Show, type JSX } from "solid-js";
import { send } from "../../ipc/bridge";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, HoverInfo, Icon, RIBBON_HELP, RibbonHelp } from "../../solid-ui";
import { useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import { EQ_BAND_COUNT, type EqAutomationPoint } from "../../state/types";
import { EqGraph } from "./EqGraph.solid";
import styles from "./MasterEqPanel.module.css";

export interface MasterEqPanelProps {
  header?: JSX.Element;
  panelId?: string;
  labelledBy?: string;
  embedded?: boolean;
}

export function MasterEqPanel(props: MasterEqPanelProps = {}) {
  const automation = createStoreSelector(useProjectStore, (state) => state.project.masterEqAutomation);
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const position = createStoreSelector(useTransportStore, (state) => state.positionBeat);
  const current = createMemo(() => interpolateEq(automation(), position()));

  function setBand(index: number, db: number) {
    let next = [...automation()];
    if (next.length === 0) {
      next = [{ atBeat: 0, bandsDb: new Array(EQ_BAND_COUNT).fill(0) }];
    }
    const first = next[0];
    next[0] = {
      ...first,
      bandsDb: first.bandsDb.map((value, bandIndex) => bandIndex === index ? db : value),
    };
    useProjectStore.getState().loadProject({ ...project(), masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  const graph = () => <div class={`${styles.graphHost} ${props.embedded ? styles.graphEmbedded : ""}`}><EqGraph bandsDb={current()} onChange={setBand} /></div>;

  return (
    <Show
      when={!props.embedded}
      fallback={graph()}
    >
      <section class={styles.panel} id={props.panelId} role={props.labelledBy ? "tabpanel" : undefined} aria-label={props.labelledBy ? undefined : "Global Mastering"} aria-labelledby={props.labelledBy}>
        <header class={styles.ribbon}>
          <Show
            when={props.header}
            fallback={(
              <span class={styles.titleGroup}>
                <span class={styles.title}>Global Mastering</span>
                <RibbonHelp label="Global Mastering" pages={RIBBON_HELP.mastering} />
              </span>
            )}
          >
            {props.header}
          </Show>
          <div class={styles.ribbonActions}>
            <HoverInfo content="Open EQ automation editor">
              <Button class={styles.editButton} iconOnly size="xs" onClick={() => useUiStore.getState().openEditor({ kind: "eq" })} aria-label="Edit automation">
                <Icon name="ph:pencil-simple" size={18} decorative />
              </Button>
            </HoverInfo>
          </div>
        </header>
        {graph()}
      </section>
    </Show>
  );
}

function interpolateEq(points: EqAutomationPoint[], beat: number): number[] {
  if (points.length === 0) return new Array(EQ_BAND_COUNT).fill(0);
  const sorted = [...points].sort((a, b) => a.atBeat - b.atBeat);
  if (beat <= sorted[0].atBeat) return [...sorted[0].bandsDb];
  if (beat >= sorted[sorted.length - 1].atBeat) return [...sorted[sorted.length - 1].bandsDb];
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (beat >= previous.atBeat && beat <= next.atBeat) {
      const t = (beat - previous.atBeat) / (next.atBeat - previous.atBeat);
      return previous.bandsDb.map((value, bandIndex) => value + ((next.bandsDb[bandIndex] ?? 0) - value) * t);
    }
  }
  return [...sorted[0].bandsDb];
}
