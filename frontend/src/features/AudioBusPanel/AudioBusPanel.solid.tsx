import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { appConfirm, Button, FloatingSelect, HoverInfo, Icon, MicroButton, Slider, TextInput } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { canSetAudioBusOutput } from "../../state/audioBusRouting";
import { useProjectStore } from "../../state/store";
import type { Id, ReturnBus } from "../../state/types";
import { MasterEqPanel } from "../Eq/MasterEqPanel.solid";
import styles from "./AudioBusPanel.module.css";

const MASTER_TAB_ID = "master";
const NO_OUTPUT_VALUE = "none";

export function AudioBusPanel() {
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const buses = createMemo(() => [...project().returnBuses].sort((a, b) => (a.mixerOrder ?? 0) - (b.mixerOrder ?? 0)));
  const [activeId, setActiveId] = createSignal<Id>(MASTER_TAB_ID);
  const activeBus = createMemo(() => buses().find((bus) => bus.id === activeId()) ?? null);

  createEffect(() => {
    if (activeId() !== MASTER_TAB_ID && !activeBus()) setActiveId(MASTER_TAB_ID);
  });

  function addBus() {
    const id = useProjectStore.getState().addAudioBus();
    setActiveId(id);
    focusTab(id);
  }

  const tabs = () => (
    <BusTabs
      buses={buses()}
      activeId={activeId()}
      onSelect={setActiveId}
      onAdd={addBus}
    />
  );

  return (
    <Show
      when={activeBus()}
      fallback={<MasterEqPanel header={tabs()} panelId="audio-bus-panel-master" labelledBy="audio-bus-tab-master" />}
    >
      {(bus) => (
        <BusEditorPanel
          bus={bus()}
          buses={buses()}
          tracks={project().tracks}
          header={tabs()}
          onDeleted={() => setActiveId(MASTER_TAB_ID)}
        />
      )}
    </Show>
  );
}

interface BusTabsProps {
  buses: ReturnBus[];
  activeId: Id;
  onSelect: (id: Id) => void;
  onAdd: () => void;
}

function BusTabs(props: BusTabsProps) {
  const tabIds = () => [MASTER_TAB_ID, ...props.buses.map((bus) => bus.id)];

  function selectAndFocus(id: Id) {
    props.onSelect(id);
    focusTab(id);
  }

  function onTabKeyDown(event: KeyboardEvent, id: Id) {
    const ids = tabIds();
    const index = Math.max(0, ids.indexOf(id));
    let next: Id | undefined;
    if (event.key === "ArrowRight") next = ids[(index + 1) % ids.length];
    else if (event.key === "ArrowLeft") next = ids[(index - 1 + ids.length) % ids.length];
    else if (event.key === "Home") next = ids[0];
    else if (event.key === "End") next = ids[ids.length - 1];
    if (!next) return;
    event.preventDefault();
    selectAndFocus(next);
  }

  return (
    <div class={styles.tabHeader}>
      <div class={styles.tabs} role="tablist" aria-label="Master and audio buses">
        <Button
          role="tab"
          id="audio-bus-tab-master"
          data-audio-bus-tab={MASTER_TAB_ID}
          aria-controls="audio-bus-panel-master"
          aria-selected={props.activeId === MASTER_TAB_ID}
          tabIndex={props.activeId === MASTER_TAB_ID ? 0 : -1}
          class={`${styles.tab} ${props.activeId === MASTER_TAB_ID ? styles.tabActive : ""}`}
          onClick={() => props.onSelect(MASTER_TAB_ID)}
          onKeyDown={(event) => onTabKeyDown(event, MASTER_TAB_ID)}
        >
          Master
        </Button>
        <For each={props.buses}>
          {(bus) => (
            <Button
              role="tab"
              id={`audio-bus-tab-${bus.id}`}
              data-audio-bus-tab={bus.id}
              aria-controls={`audio-bus-panel-${bus.id}`}
              aria-selected={props.activeId === bus.id}
              tabIndex={props.activeId === bus.id ? 0 : -1}
              class={`${styles.tab} ${props.activeId === bus.id ? styles.tabActive : ""}`}
              onClick={() => props.onSelect(bus.id)}
              onKeyDown={(event) => onTabKeyDown(event, bus.id)}
              title={bus.name}
            >
              {bus.name}
            </Button>
          )}
        </For>
      </div>
      <HoverInfo content="Create audio bus">
        <Button iconOnly size="xs" class={styles.addTab} onClick={props.onAdd} aria-label="Create audio bus">
          <Icon name="ph:plus" size={18} decorative />
        </Button>
      </HoverInfo>
    </div>
  );
}

interface BusEditorPanelProps {
  bus: ReturnBus;
  buses: ReturnBus[];
  tracks: Array<{ id: Id; outputBusId?: Id; outputEnabled?: boolean; sends?: Array<{ busId: Id; enabled: boolean }> }>;
  header: JSX.Element;
  onDeleted: () => void;
}

function BusEditorPanel(props: BusEditorPanelProps) {
  const meter = createStoreSelector(useAnalyzerStore, (state) => state.trackMeters[props.bus.id]);
  const updateBus = (patch: Partial<ReturnBus>) => useProjectStore.getState().updateReturnBus(props.bus.id, patch);
  const primaryTrackInputs = () => props.tracks.filter((track) => track.outputEnabled !== false && track.outputBusId === props.bus.id).length;
  const primaryBusInputs = () => props.buses.filter((bus) => bus.outputEnabled !== false && bus.outputBusId === props.bus.id).length;
  const sendInputs = () => [
    ...props.tracks.flatMap((track) => track.sends ?? []),
    ...props.buses.flatMap((bus) => bus.sends ?? []),
  ].filter((send) => send.enabled && send.busId === props.bus.id).length;
  const outputValue = () => props.bus.outputEnabled === false
    ? NO_OUTPUT_VALUE
    : props.bus.outputBusId ?? MASTER_TAB_ID;
  const outputOptions = () => [
    { value: MASTER_TAB_ID, label: "Master" },
    { value: NO_OUTPUT_VALUE, label: "No Output" },
    ...props.buses
      .filter((candidate) => candidate.id !== props.bus.id)
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.name,
        disabled: !canSetAudioBusOutput(props.buses, props.bus.id, candidate.id),
      })),
    ...(props.bus.outputBusId && !props.buses.some((candidate) => candidate.id === props.bus.outputBusId)
      ? [{ value: props.bus.outputBusId, label: `Missing: ${props.bus.outputBusId}`, disabled: true }]
      : []),
  ];

  function setOutput(value: string) {
    if (value === NO_OUTPUT_VALUE) {
      useProjectStore.getState().setAudioBusOutput(props.bus.id, undefined, false);
      return;
    }
    useProjectStore.getState().setAudioBusOutput(props.bus.id, value === MASTER_TAB_ID ? undefined : value, true);
  }

  async function removeBus() {
    const confirmed = await appConfirm(`Delete “${props.bus.name}”? Tracks routed to it will be disconnected.`);
    if (!confirmed) return;
    useProjectStore.getState().removeReturnBus(props.bus.id);
    props.onDeleted();
    focusTab(MASTER_TAB_ID);
  }

  return (
    <section
      class={styles.panel}
      id={`audio-bus-panel-${props.bus.id}`}
      role="tabpanel"
      aria-labelledby={`audio-bus-tab-${props.bus.id}`}
      data-audio-bus-panel={props.bus.id}
    >
      <header class={styles.ribbon}>
        {props.header}
        <div class={styles.ribbonActions}>
          <Button size="xs" class={styles.actionButton} onClick={() => useProjectStore.getState().addReturnBusEffect(props.bus.id)}>
            Add Insert
          </Button>
          <HoverInfo content={`Delete ${props.bus.name}`}>
            <Button iconOnly size="xs" class={styles.iconAction} onClick={() => void removeBus()} aria-label={`Delete ${props.bus.name}`}>
              <Icon name="ph:trash" size={18} decorative />
            </Button>
          </HoverInfo>
        </div>
      </header>

      <div class={styles.busBody}>
        <div class={styles.identityColumn}>
          <TextInput
            label="Name"
            layout="inline"
            value={props.bus.name}
            onChange={(event) => updateBus({ name: event.currentTarget.value })}
            aria-label="Audio bus name"
          />
          <FloatingSelect
            label="Output"
            layout="inline"
            value={outputValue()}
            options={outputOptions()}
            onChange={setOutput}
            ariaLabel={`${props.bus.name} output destination`}
          />
          <div class={styles.inputSummary} aria-label={`${props.bus.name} input summary`}>
            {primaryTrackInputs()} tracks · {primaryBusInputs()} buses · {sendInputs()} sends
          </div>
        </div>

        <div class={styles.meterColumn} aria-label={`${props.bus.name} stereo meter`} role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow={Math.max(meter()?.leftPeak ?? 0, meter()?.rightPeak ?? 0)}>
          <span class={styles.meterLane}><span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter()?.leftPeak ?? meter()?.peak ?? 0)})` }} /></span>
          <span class={styles.meterLane}><span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter()?.rightPeak ?? meter()?.peak ?? 0)})` }} /></span>
        </div>

        <div class={styles.controlGrid}>
          <Slider
            label="Trim"
            layout="inline"
            min={-24}
            max={24}
            step={0.1}
            value={props.bus.inputTrimDb ?? 0}
            onChange={(inputTrimDb) => updateBus({ inputTrimDb })}
            readout={<span class={styles.readout}>{formatDb(props.bus.inputTrimDb ?? 0)}</span>}
          />
          <Slider
            label="Level"
            layout="inline"
            min={-48}
            max={12}
            step={0.1}
            value={props.bus.gainDb}
            onChange={(gainDb) => updateBus({ gainDb })}
            readout={<span class={styles.readout}>{formatDb(props.bus.gainDb)}</span>}
          />
          <Slider
            label="Pan"
            layout="inline"
            min={-1}
            max={1}
            step={0.01}
            value={props.bus.pan}
            onChange={(pan) => updateBus({ pan })}
            readout={<span class={styles.readout}>{formatPan(props.bus.pan)}</span>}
          />
        </div>

        <div class={styles.stateColumn}>
          <div class={styles.stateButtons} aria-label={`${props.bus.name} channel state`}>
            <MicroButton active={props.bus.solo === true} onClick={() => updateBus({ solo: !props.bus.solo })} aria-label={`Solo ${props.bus.name}`}>S</MicroButton>
            <MicroButton active={props.bus.mute} onClick={() => updateBus({ mute: !props.bus.mute })} aria-label={`Mute ${props.bus.name}`}>M</MicroButton>
            <MicroButton active={props.bus.soloSafe === true} onClick={() => updateBus({ soloSafe: !props.bus.soloSafe })} aria-label={`Solo-safe ${props.bus.name}`}>Safe</MicroButton>
          </div>
          <div class={styles.busMeta}>
            <span>{props.bus.effects.filters.length} inserts</span>
            <span>{props.bus.sends?.filter((send) => send.enabled).length ?? 0} active sends</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function focusTab(id: Id) {
  queueMicrotask(() => {
    document.querySelector<HTMLElement>(`[data-audio-bus-tab="${CSS.escape(id)}"]`)?.focus();
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatDb(value: number): string {
  if (Math.abs(value) < 0.05) return "0 dB";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function formatPan(value: number): string {
  if (Math.abs(value) < 0.01) return "C";
  return `${value < 0 ? "L" : "R"}${Math.round(Math.abs(value) * 100)}`;
}
