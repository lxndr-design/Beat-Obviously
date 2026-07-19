import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { appConfirm, Button, FloatingSelect, HoverInfo, Icon, MicroButton, Slider, TextInput } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { canSetAudioBusOutput, canSetAudioBusSend } from "../../state/audioBusRouting";
import { EFFECT_LABELS, EFFECT_OPTIONS, type EffectKind } from "../../state/effects";
import { useProjectStore } from "../../state/store";
import type { Id, ReturnBus, TrackEffect, TrackSend } from "../../state/types";
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
  const [newEffectKind, setNewEffectKind] = createSignal<EffectKind>("reverb");
  const [newSendDestinationId, setNewSendDestinationId] = createSignal<Id>("");
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
  const sendDestinations = () => props.buses.filter((candidate) => (
    candidate.id !== props.bus.id
    && !(props.bus.sends ?? []).some((send) => send.busId === candidate.id)
    && canSetAudioBusSend(props.buses, props.bus.id, candidate.id, { enabled: true })
  ));
  const sendDestinationOptions = () => sendDestinations().length > 0
    ? sendDestinations().map((candidate) => ({ value: candidate.id, label: candidate.name }))
    : [{ value: "", label: "No destination", disabled: true }];

  createEffect(() => {
    const available = sendDestinations();
    if (!available.some((candidate) => candidate.id === newSendDestinationId())) {
      setNewSendDestinationId(available[0]?.id ?? "");
    }
  });

  function setOutput(value: string) {
    if (value === NO_OUTPUT_VALUE) {
      useProjectStore.getState().setAudioBusOutput(props.bus.id, undefined, false);
      return;
    }
    useProjectStore.getState().setAudioBusOutput(props.bus.id, value === MASTER_TAB_ID ? undefined : value, true);
  }

  function addInsert() {
    useProjectStore.getState().addReturnBusEffect(props.bus.id, newEffectKind());
  }

  function addSend() {
    const destinationId = newSendDestinationId();
    if (!destinationId) return;
    useProjectStore.getState().upsertAudioBusSend(props.bus.id, destinationId, {
      enabled: true,
      gainDb: -12,
      pan: 0,
      preFader: false,
    });
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
          <FloatingSelect
            label="Mode"
            layout="inline"
            value={props.bus.channelLayout ?? "stereo"}
            options={[
              { value: "stereo", label: "Stereo" },
              { value: "mono", label: "Mono" },
            ]}
            onChange={(channelLayout) => updateBus({ channelLayout: channelLayout === "mono" ? "mono" : "stereo" })}
            ariaLabel={`${props.bus.name} channel mode`}
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

        <section class={styles.rack} aria-label={`${props.bus.name} inserts`}>
          <div class={styles.rackHeader}>
            <span class={styles.rackTitle}>Inserts</span>
            <FloatingSelect
              layout="bare"
              value={newEffectKind()}
              options={EFFECT_OPTIONS}
              onChange={(value) => setNewEffectKind(value as EffectKind)}
              ariaLabel="New insert type"
            />
            <Button size="xs" class={styles.rackAdd} onClick={addInsert}>Add</Button>
          </div>
          <div class={styles.rackRows}>
            <Show when={props.bus.effects.filters.length > 0} fallback={<span class={styles.rackEmpty}>No inserts</span>}>
              <For each={props.bus.effects.filters}>
                {(effect, index) => (
                  <InsertRow
                    busId={props.bus.id}
                    effect={effect}
                    index={index()}
                    count={props.bus.effects.filters.length}
                  />
                )}
              </For>
            </Show>
          </div>
        </section>

        <section class={styles.rack} aria-label={`${props.bus.name} sends`}>
          <div class={styles.rackHeader}>
            <span class={styles.rackTitle}>Sends</span>
            <FloatingSelect
              layout="bare"
              value={newSendDestinationId()}
              options={sendDestinationOptions()}
              onChange={setNewSendDestinationId}
              ariaLabel="New send destination"
              disabled={sendDestinations().length === 0}
            />
            <Button size="xs" class={styles.rackAdd} onClick={addSend} disabled={!newSendDestinationId()}>Add</Button>
          </div>
          <div class={styles.rackRows}>
            <Show when={(props.bus.sends?.length ?? 0) > 0} fallback={<span class={styles.rackEmpty}>No sends</span>}>
              <For each={props.bus.sends ?? []}>
                {(send) => <SendRow bus={props.bus} send={send} buses={props.buses} />}
              </For>
            </Show>
          </div>
        </section>
      </div>
    </section>
  );
}

interface InsertRowProps {
  busId: Id;
  effect: TrackEffect;
  index: number;
  count: number;
}

function InsertRow(props: InsertRowProps) {
  const store = () => useProjectStore.getState();
  return (
    <div class={`${styles.rackRow} ${props.effect.bypassed ? styles.rackRowBypassed : ""}`}>
      <Button
        size="xs"
        variant="ghost"
        selected={!props.effect.bypassed}
        class={styles.rackName}
        aria-pressed={!props.effect.bypassed}
        onClick={() => store().updateReturnBusEffect(props.busId, props.effect.id, { bypassed: !props.effect.bypassed })}
      >
        {EFFECT_LABELS[props.effect.kind]}
      </Button>
      <Button iconOnly size="xs" variant="ghost" onClick={() => store().moveReturnBusEffect(props.busId, props.effect.id, -1)} disabled={props.index === 0} aria-label="Move insert up">
        <Icon name="ph:caret-up" size={18} decorative />
      </Button>
      <Button iconOnly size="xs" variant="ghost" onClick={() => store().moveReturnBusEffect(props.busId, props.effect.id, 1)} disabled={props.index === props.count - 1} aria-label="Move insert down">
        <Icon name="ph:caret-down" size={18} decorative />
      </Button>
      <Button iconOnly size="xs" variant="ghost" onClick={() => store().removeReturnBusEffect(props.busId, props.effect.id)} aria-label="Remove insert">
        <Icon name="ph:x" size={18} decorative />
      </Button>
    </div>
  );
}

interface SendRowProps {
  bus: ReturnBus;
  send: TrackSend;
  buses: ReturnBus[];
}

function SendRow(props: SendRowProps) {
  const destination = () => props.buses.find((candidate) => candidate.id === props.send.busId);
  const updateSend = (patch: Partial<TrackSend>) => useProjectStore.getState().upsertAudioBusSend(props.bus.id, props.send.busId, patch);
  return (
    <div class={styles.sendRow}>
      <MicroButton active={props.send.enabled} onClick={() => updateSend({ enabled: !props.send.enabled })} aria-label={`Enable send to ${destination()?.name ?? "missing bus"}`}>
        {props.send.enabled ? "On" : "Off"}
      </MicroButton>
      <span class={styles.sendName} title={destination()?.name ?? props.send.busId}>{destination()?.name ?? "Missing bus"}</span>
      <Slider
        layout="bare"
        min={-96}
        max={12}
        step={0.1}
        value={props.send.gainDb}
        disabled={!props.send.enabled}
        onChange={(gainDb) => updateSend({ gainDb })}
        ariaLabel={`Send level to ${destination()?.name ?? "missing bus"}`}
        readout={<span class={styles.readout}>{formatDb(props.send.gainDb)}</span>}
      />
      <MicroButton active={props.send.preFader === true} onClick={() => updateSend({ preFader: !props.send.preFader })} aria-label={`Use pre-fader send to ${destination()?.name ?? "missing bus"}`}>
        {props.send.preFader ? "Pre" : "Post"}
      </MicroButton>
      <Button iconOnly size="xs" variant="ghost" onClick={() => useProjectStore.getState().removeAudioBusSend(props.bus.id, props.send.busId)} aria-label="Remove send">
        <Icon name="ph:x" size={18} decorative />
      </Button>
    </div>
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
