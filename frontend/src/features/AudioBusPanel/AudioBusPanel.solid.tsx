import { createEffect, createMemo, createSignal, For, Index, Show, type JSX } from "solid-js";
import { appConfirm, Button, FloatingSelect, HoverInfo, Icon, Knob, MicroButton, RowItem, SectionRibbon, Slider, TextInput } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { canSetAudioBusOutput, canSetAudioBusSend, getMasterInputBuses } from "../../state/audioBusRouting";
import { EFFECT_DEFAULT_PARAMS, EFFECT_LABELS, EFFECT_OPTIONS, EFFECT_PARAM_SPECS, type EffectKind, type EffectParamSpec } from "../../state/effects";
import { useProjectStore, useUiStore } from "../../state/store";
import type { Id, ReturnBus, Track, TrackEffect, TrackSend } from "../../state/types";
import { MasterEqPanel } from "../Eq/MasterEqPanel.solid";
import { SynthCurvePreview } from "../Synth/CurvePreview/SynthCurvePreview.solid";
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
      fallback={<MasterEditorPanel buses={buses()} header={tabs()} />}
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
        <AddBusTabButton onAdd={props.onAdd} />
      </div>
    </div>
  );
}

function AddBusTabButton(props: { onAdd: () => void }) {
  return (
    <Button iconOnly size="xs" class={styles.addTab} onClick={props.onAdd} aria-label="Create audio bus" title="Create audio bus">
      <Icon name="ph:plus" size={18} decorative />
    </Button>
  );
}

function MasterEditorPanel(props: { buses: ReturnBus[]; header: JSX.Element }) {
  const master = createStoreSelector(useProjectStore, (state) => state.project.masterChain);
  const updateMaster = (patch: Partial<ReturnType<typeof master>>) => useProjectStore.getState().updateMasterChain(patch);
  const inputSources = createMemo<BusInputSource[]>(() => getMasterInputBuses(props.buses)
    .map((bus) => ({
      id: `bus:${bus.id}`,
      name: bus.name,
      detail: "Bus",
      levelDb: bus.gainDb,
      onLevelChange: (gainDb: number) => useProjectStore.getState().updateReturnBus(bus.id, { gainDb }),
    })));
  const compressorEffect = createMemo<TrackEffect>(() => ({
    id: "master-compressor",
    kind: "compressor",
    bypassed: !master().compressorEnabled,
    params: {
      thresholdDb: master().compressorThresholdDb,
      ratio: master().compressorRatio,
      attackMs: master().compressorAttackMs,
      releaseMs: master().compressorReleaseMs,
      makeupDb: master().compressorMakeupDb,
      mix: master().compressorMix,
    },
  }));

  function updateCompressorParam(key: string, value: number) {
    if (key === "thresholdDb") updateMaster({ compressorThresholdDb: value });
    else if (key === "ratio") updateMaster({ compressorRatio: value });
    else if (key === "attackMs") updateMaster({ compressorAttackMs: value });
    else if (key === "releaseMs") updateMaster({ compressorReleaseMs: value });
    else if (key === "makeupDb") updateMaster({ compressorMakeupDb: value });
    else if (key === "mix") updateMaster({ compressorMix: value });
  }

  return (
    <section class={styles.panel} id="audio-bus-panel-master" role="tabpanel" aria-labelledby="audio-bus-tab-master">
      <header class={styles.ribbon}>{props.header}</header>
      <div class={`${styles.busBody} ${styles.masterBody}`}>
        <section class={styles.inputSection} aria-label="Master inputs">
          <SectionTitle title="Inputs" meta={`${inputSources().length} ${inputSources().length === 1 ? "bus" : "buses"}`} />
          <ul class={styles.inputRows}>
            <Show when={inputSources().length > 0} fallback={<li class={styles.emptyState}>No buses routed to Master</li>}>
              <Index each={inputSources()}>{(source) => <BusInputRow source={source} />}</Index>
            </Show>
          </ul>
        </section>

        <section class={styles.parametersSection} aria-label="Master parameters">
          <SectionTitle title="Parameters" />
          <div class={`${styles.knobStack} ${styles.masterKnobs}`}>
            <Knob size="sm" label="Input Trim" min={-24} max={24} step={0.1} value={master().inputGainDb} defaultValue={0} unit="dB" formatValue={formatCompact} onChange={(inputGainDb) => updateMaster({ inputGainDb })} />
            <Knob size="sm" label="Fader" min={-48} max={12} step={0.1} value={master().outputGainDb} defaultValue={0} unit="dB" formatValue={formatCompact} onChange={(outputGainDb) => updateMaster({ outputGainDb })} />
          </div>
        </section>

        <section class={`${styles.insertSection} ${styles.masterInserts}`} aria-label="Master inserts">
          <SectionRibbon className={styles.rackHeader} title="Inserts" expanded showToggle={false} onToggle={() => undefined} />
          <div class={styles.insertCards}>
            <article class={`${styles.insertCard} ${styles.masterEqCard}`}>
              <header class={styles.insertCardHeader}>
                <Button iconOnly size="xs" variant="ghost" selected disabled className={styles.insertPower} aria-label="Master EQ enabled">
                  <Icon name="ph:power-fill" size={18} decorative />
                </Button>
                <strong>EQ</strong>
                <div class={styles.insertActions}>
                  <Button iconOnly size="xs" variant="ghost" onClick={() => useUiStore.getState().openEditor({ kind: "eq" })} aria-label="Edit EQ automation"><Icon name="ph:pencil-simple" size={18} decorative /></Button>
                </div>
              </header>
              <div class={styles.masterEqGraph}><MasterEqPanel embedded /></div>
            </article>

            <article class={`${styles.insertCard} ${!master().compressorEnabled ? styles.insertCardBypassed : ""}`}>
              <header class={styles.insertCardHeader}>
                <Button iconOnly size="xs" variant="ghost" selected={master().compressorEnabled} className={styles.insertPower} onClick={() => updateMaster({ compressorEnabled: !master().compressorEnabled })} aria-label={`${master().compressorEnabled ? "Bypass" : "Enable"} Master compressor`}>
                  <Icon name={master().compressorEnabled ? "ph:power-fill" : "ph:power"} size={18} decorative />
                </Button>
                <strong>Compressor</strong>
              </header>
              <div class={styles.insertGraph}><SynthCurvePreview samples={effectResponseSamples(compressorEffect())} label="Master compressor parameter response preview" filled /></div>
              <div class={styles.effectParameters}>
                <For each={EFFECT_PARAM_SPECS.compressor}>{(param) => <EffectKnob effect={compressorEffect()} param={param} onChange={(value) => updateCompressorParam(param.key, value)} />}</For>
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}

interface BusEditorPanelProps {
  bus: ReturnBus;
  buses: ReturnBus[];
  tracks: Track[];
  header: JSX.Element;
  onDeleted: () => void;
}

interface BusInputSource {
  id: string;
  name: string;
  detail: string;
  levelDb: number;
  onLevelChange: (gainDb: number) => void;
}

function SectionTitle(props: { title: string; meta?: string }) {
  return (
    <SectionRibbon
      title={props.title}
      expanded
      showToggle={false}
      onToggle={() => undefined}
      actions={<Show when={props.meta}><span class={styles.sectionMeta}>{props.meta}</span></Show>}
    />
  );
}

function BusInputRow(props: { source: () => BusInputSource }) {
  return (
    <RowItem
      className={styles.inputRow}
      density="media"
      cursor="default"
      name={props.source().name}
      meta={props.source().detail}
      title={`${props.source().name} · ${props.source().detail}`}
      action={(
        <Knob
          className={styles.inputLevelKnob}
          size="sm"
          label={`${props.source().name} input volume`}
          min={-96}
          max={24}
          step={0.1}
          value={props.source().levelDb}
          defaultValue={0}
          unit="dB"
          formatValue={formatCompact}
          onChange={props.source().onLevelChange}
        />
      )}
    />
  );
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
  const inputSources = createMemo<BusInputSource[]>(() => [
    ...props.tracks
      .filter((track) => track.outputEnabled !== false && track.outputBusId === props.bus.id)
      .map((track) => ({
        id: `track:${track.id}`,
        name: track.name,
        detail: "Track",
        levelDb: track.gainDb,
        onLevelChange: (gainDb: number) => useProjectStore.getState().updateTrack(track.id, { gainDb }),
      })),
    ...props.buses
      .filter((bus) => bus.id !== props.bus.id && bus.outputEnabled !== false && bus.outputBusId === props.bus.id)
      .map((bus) => ({
        id: `bus:${bus.id}`,
        name: bus.name,
        detail: "Bus",
        levelDb: bus.gainDb,
        onLevelChange: (gainDb: number) => useProjectStore.getState().updateReturnBus(bus.id, { gainDb }),
      })),
    ...props.tracks
      .filter((track) => (track.sends ?? []).some((send) => send.enabled && send.busId === props.bus.id))
      .map((track) => {
        const send = track.sends?.find((candidate) => candidate.enabled && candidate.busId === props.bus.id);
        return {
          id: `track-send:${track.id}`,
          name: track.name,
          detail: "Track send",
          levelDb: send?.gainDb ?? 0,
          onLevelChange: (gainDb: number) => useProjectStore.getState().upsertTrackSend(track.id, props.bus.id, { gainDb }),
        };
      }),
    ...props.buses
      .filter((bus) => bus.id !== props.bus.id && (bus.sends ?? []).some((send) => send.enabled && send.busId === props.bus.id))
      .map((bus) => {
        const send = bus.sends?.find((candidate) => candidate.enabled && candidate.busId === props.bus.id);
        return {
          id: `bus-send:${bus.id}`,
          name: bus.name,
          detail: "Bus send",
          levelDb: send?.gainDb ?? 0,
          onLevelChange: (gainDb: number) => useProjectStore.getState().upsertAudioBusSend(bus.id, props.bus.id, { gainDb }),
        };
      }),
  ]);
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
        <section class={styles.inputSection} aria-label={`${props.bus.name} inputs`}>
          <SectionTitle title="Inputs" meta={`${primaryTrackInputs()} tracks · ${primaryBusInputs()} buses · ${sendInputs()} sends`} />
          <ul class={styles.inputRows}>
            <Show when={inputSources().length > 0} fallback={<li class={styles.emptyState}>No routed inputs</li>}>
              <Index each={inputSources()}>{(source) => <BusInputRow source={source} />}</Index>
            </Show>
          </ul>
        </section>

        <section class={styles.parametersSection} aria-label={`${props.bus.name} parameters`}>
          <SectionTitle title="Parameters" />
          <div class={styles.knobStack}>
            <Knob size="sm" label="Input Trim" min={-24} max={24} step={0.1} value={props.bus.inputTrimDb ?? 0} defaultValue={0} unit="dB" formatValue={formatCompact} onChange={(inputTrimDb) => updateBus({ inputTrimDb })} />
            <Knob size="sm" label="Pan" min={-1} max={1} step={0.01} value={props.bus.pan} defaultValue={0} bipolar formatValue={formatPan} onChange={(pan) => updateBus({ pan })} />
            <Knob size="sm" label="Fader" min={-48} max={12} step={0.1} value={props.bus.gainDb} defaultValue={0} unit="dB" formatValue={formatCompact} onChange={(gainDb) => updateBus({ gainDb })} />
          </div>
          <div class={styles.stateButtons} aria-label={`${props.bus.name} channel state`}>
            <MicroButton active={props.bus.solo === true} onClick={() => updateBus({ solo: !props.bus.solo })} aria-label={`Solo ${props.bus.name}`}>S</MicroButton>
            <MicroButton active={props.bus.mute} onClick={() => updateBus({ mute: !props.bus.mute })} aria-label={`Mute ${props.bus.name}`}>M</MicroButton>
            <MicroButton active={props.bus.soloSafe === true} onClick={() => updateBus({ soloSafe: !props.bus.soloSafe })} aria-label={`Solo-safe ${props.bus.name}`}>Safe</MicroButton>
          </div>
        </section>

        <section class={styles.insertSection} aria-label={`${props.bus.name} inserts`}>
          <SectionRibbon
            className={styles.rackHeader}
            title="Inserts"
            expanded
            showToggle={false}
            onToggle={() => undefined}
            actions={(
              <div class={styles.rackHeaderActions}>
                <FloatingSelect
                  layout="bare"
                  value={newEffectKind()}
                  options={EFFECT_OPTIONS}
                  onChange={(value) => setNewEffectKind(value as EffectKind)}
                  ariaLabel="New insert type"
                />
                <Button size="xs" class={styles.rackAdd} onClick={addInsert}>Add</Button>
              </div>
            )}
          />
          <div class={styles.insertCards}>
            <Show when={props.bus.effects.filters.length > 0} fallback={<span class={styles.emptyState}>No inserts</span>}>
              <For each={props.bus.effects.filters.map((effect) => effect.id)}>
                {(effectId, index) => {
                  const effect = () => props.bus.effects.filters.find((candidate) => candidate.id === effectId);
                  return (
                    <Show when={effect()}>
                      {(currentEffect) => (
                        <InsertCard
                          busId={props.bus.id}
                          effect={currentEffect()}
                          index={index()}
                          count={props.bus.effects.filters.length}
                        />
                      )}
                    </Show>
                  );
                }}
              </For>
            </Show>
          </div>
        </section>

        <section class={styles.outputSection} aria-label={`${props.bus.name} output`}>
          <SectionTitle title="Output" />
          <TextInput label="Name" layout="inline" value={props.bus.name} onChange={(event) => updateBus({ name: event.currentTarget.value })} aria-label="Audio bus name" />
          <FloatingSelect label="Bus to" layout="inline" value={outputValue()} options={outputOptions()} onChange={setOutput} ariaLabel={`${props.bus.name} output destination`} />
          <FloatingSelect label="Mode" layout="inline" value={props.bus.channelLayout ?? "stereo"} options={[{ value: "stereo", label: "Stereo" }, { value: "mono", label: "Mono" }]} onChange={(channelLayout) => updateBus({ channelLayout: channelLayout === "mono" ? "mono" : "stereo" })} ariaLabel={`${props.bus.name} channel mode`} />
          <div class={styles.outputMeter} aria-label={`${props.bus.name} stereo meter`} role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow={Math.max(meter()?.leftPeak ?? 0, meter()?.rightPeak ?? 0)}>
            <span class={styles.meterLane}><span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter()?.leftPeak ?? meter()?.peak ?? 0)})` }} /></span>
            <span class={styles.meterLane}><span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter()?.rightPeak ?? meter()?.peak ?? 0)})` }} /></span>
          </div>
          <SectionRibbon
            className={styles.sendHeader}
            title="Sends"
            expanded
            showToggle={false}
            onToggle={() => undefined}
            actions={(
              <div class={styles.rackHeaderActions}>
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
            )}
          />
          <div class={styles.sendRows}>
            <Show when={(props.bus.sends?.length ?? 0) > 0} fallback={<span class={styles.emptyState}>No sends</span>}>
              <For each={(props.bus.sends ?? []).map((send) => send.busId)}>
                {(destinationBusId) => {
                  const send = () => props.bus.sends?.find((candidate) => candidate.busId === destinationBusId);
                  return (
                    <Show when={send()}>
                      {(currentSend) => <SendRow bus={props.bus} send={currentSend()} buses={props.buses} />}
                    </Show>
                  );
                }}
              </For>
            </Show>
          </div>
        </section>
      </div>
    </section>
  );
}

interface InsertCardProps {
  busId: Id;
  effect: TrackEffect;
  index: number;
  count: number;
}

function InsertCard(props: InsertCardProps) {
  const store = () => useProjectStore.getState();
  const patchParam = (key: string, value: number) => store().updateReturnBusEffect(props.busId, props.effect.id, { params: { ...props.effect.params, [key]: value } });
  return (
    <article class={`${styles.insertCard} ${props.effect.bypassed ? styles.insertCardBypassed : ""}`}>
      <header class={styles.insertCardHeader}>
        <Button iconOnly size="xs" variant="ghost" selected={!props.effect.bypassed} className={styles.insertPower} onClick={() => store().updateReturnBusEffect(props.busId, props.effect.id, { bypassed: !props.effect.bypassed })} aria-label={`${props.effect.bypassed ? "Enable" : "Bypass"} ${EFFECT_LABELS[props.effect.kind]}`}>
          <Icon name={props.effect.bypassed ? "ph:power" : "ph:power-fill"} size={18} decorative />
        </Button>
        <strong>{EFFECT_LABELS[props.effect.kind]}</strong>
        <div class={styles.insertActions}>
          <Button iconOnly size="xs" variant="ghost" onClick={() => store().moveReturnBusEffect(props.busId, props.effect.id, -1)} disabled={props.index === 0} aria-label="Move insert earlier"><Icon name="ph:caret-up" size={18} decorative /></Button>
          <Button iconOnly size="xs" variant="ghost" onClick={() => store().moveReturnBusEffect(props.busId, props.effect.id, 1)} disabled={props.index === props.count - 1} aria-label="Move insert later"><Icon name="ph:caret-down" size={18} decorative /></Button>
          <Button iconOnly size="xs" variant="ghost" onClick={() => store().removeReturnBusEffect(props.busId, props.effect.id)} aria-label="Remove insert"><Icon name="ph:x" size={18} decorative /></Button>
        </div>
      </header>
      <div class={styles.insertGraph}>
        <SynthCurvePreview samples={effectResponseSamples(props.effect)} label={`${EFFECT_LABELS[props.effect.kind]} parameter response preview`} filled />
      </div>
      <div class={styles.effectParameters}>
        <For each={EFFECT_PARAM_SPECS[props.effect.kind]}>{(param) => <EffectKnob effect={props.effect} param={param} onChange={(value) => patchParam(param.key, value)} />}</For>
      </div>
    </article>
  );
}

function EffectKnob(props: { effect: TrackEffect; param: EffectParamSpec; onChange: (value: number) => void }) {
  const value = () => props.effect.params[props.param.key] ?? EFFECT_DEFAULT_PARAMS[props.effect.kind][props.param.key] ?? props.param.min;
  return (
    <Knob
      size="sm"
      label={props.param.label}
      min={props.param.min}
      max={props.param.max}
      step={props.param.step}
      value={value()}
      defaultValue={EFFECT_DEFAULT_PARAMS[props.effect.kind][props.param.key] ?? props.param.min}
      unit={props.param.unit}
      formatValue={(next) => formatEffectValue(next, props.param)}
      onChange={props.onChange}
    />
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

function formatCompact(value: number): string {
  if (Math.abs(value) < 0.05) return "0";
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatEffectValue(value: number, param: EffectParamSpec): string {
  if (param.unit === "Hz" && value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  if (Number.isInteger(param.step)) return Math.round(value).toString();
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function effectResponseSamples(effect: TrackEffect, count = 64): number[] {
  const p = (key: string) => effect.params[key] ?? EFFECT_DEFAULT_PARAMS[effect.kind][key] ?? 0;
  return Array.from({ length: count }, (_, index) => {
    const x = index / Math.max(1, count - 1);
    switch (effect.kind) {
      case "lowpass": {
        const cutoff = log01(p("cutoffHz"), 20, 20000);
        const slope = 1 / (1 + Math.exp((x - cutoff) * 24));
        return slope * 1.5 - 0.75;
      }
      case "highpass": {
        const cutoff = log01(p("cutoffHz"), 20, 20000);
        const slope = 1 / (1 + Math.exp((cutoff - x) * 24));
        return slope * 1.5 - 0.75;
      }
      case "compressor": {
        const threshold = clamp01((p("thresholdDb") + 60) / 60);
        const ratio = Math.max(1, p("ratio"));
        const output = x <= threshold ? x : threshold + (x - threshold) / ratio;
        return output * 1.6 - 0.8;
      }
      case "reverb": {
        const room = clamp01(p("roomSize") / 100);
        const damping = clamp01(p("damping") / 100);
        return Math.exp(-x * (1.5 + (1 - room) * 5)) * (0.8 - damping * x * 0.35) * 1.7 - 0.72;
      }
      case "delay": {
        const feedback = clamp01(p("feedback") / 100);
        const repeats = 3 + Math.round(feedback * 7);
        const phase = (x * repeats) % 1;
        return (phase < 0.08 ? Math.pow(feedback || 0.15, Math.floor(x * repeats)) : 0) * 1.5 - 0.65;
      }
      case "chorus":
      case "phaser":
      case "flanger": {
        const depth = clamp01((p("depthMs") || p("depthOct") || 1) / (effect.kind === "phaser" ? 4 : effect.kind === "flanger" ? 8 : 25));
        return Math.sin(x * Math.PI * (effect.kind === "phaser" ? 8 : 4)) * (0.18 + depth * 0.58);
      }
      case "saturator":
      case "distortion": {
        const drive = 1 + clamp01(p("drive") / 100) * 8;
        return Math.tanh((x * 2 - 1) * drive) * 0.76;
      }
      case "bitcrush": {
        const steps = Math.max(2, Math.round(p("bits")));
        return (Math.round((x * 2 - 1) * steps) / steps) * 0.76;
      }
      case "plugin":
      default:
        return (x * 2 - 1) * 0.72;
    }
  });
}

function log01(value: number, min: number, max: number): number {
  const safe = Math.max(min, Math.min(max, value));
  return (Math.log(safe) - Math.log(min)) / (Math.log(max) - Math.log(min));
}
