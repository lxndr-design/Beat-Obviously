import { createMemo, createSignal, For, Show } from "solid-js";
import { bounceTrackInPlace, unfreezeBouncedTrack } from "../ExportReview/exportActions";
import { Button, Icon, Select, Slider, Tag } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { EFFECT_LABELS, formatEffectLatency } from "../../state/effects";
import { useProjectStore, useUiStore } from "../../state/store";
import type { Id, ReturnBus, Track, TrackSend } from "../../state/types";
import styles from "./MixerPanel.module.css";

type InsertEffect = Track["effects"]["filters"][number];

export function MixerPanel() {
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const tracks = createMemo(() => project().tracks);
  const returnBuses = createMemo(() => project().returnBuses);
  const groups = createMemo(() => tracks().filter((track) => track.kind === "group"));
  const master = createMemo(() => project().masterChain);
  const activeTracks = createMemo(() => tracks().filter((track) => track.kind !== "group").length);
  const sendCount = createMemo(() => tracks().reduce((total, track) => total + (track.sends?.length ?? 0), 0));
  const effectCount = createMemo(() => tracks().reduce((total, track) => total + track.effects.filters.length, 0));

  return (
    <div class={styles.mixer} data-mixer-panel>
      <div class={styles.ribbon}>
        <div class={styles.title}>
          <Icon name="ph:sliders-horizontal" size={16} decorative />
          <span>Mixer</span>
        </div>
        <Tag>{activeTracks()} tracks</Tag>
        <Tag>{sendCount()} sends / {effectCount()} inserts</Tag>
        <Button size="sm" onClick={() => useProjectStore.getState().addReturnBus()}>Add Return</Button>
      </div>
      <Show
        when={tracks().length > 0}
        fallback={<div class={styles.empty}>Add tracks to build channel strips.</div>}
      >
        <div class={styles.stripScroller}>
          <For each={tracks()}>
            {(track) => <ChannelStrip track={track} groups={groups()} returnBuses={returnBuses()} />}
          </For>
          <For each={returnBuses()}>
            {(bus) => <ReturnStrip bus={bus} />}
          </For>
          <MasterStrip inputGainDb={master().inputGainDb} outputGainDb={master().outputGainDb} />
        </div>
      </Show>
    </div>
  );
}

interface ChannelStripProps {
  track: Track;
  groups: Track[];
  returnBuses: ReturnBus[];
}

function ChannelStrip(props: ChannelStripProps) {
  const meter = createStoreSelector(useAnalyzerStore, (state) => state.trackMeters[props.track.id]);
  const [bounceStatus, setBounceStatus] = createSignal("");
  const [bounceBusy, setBounceBusy] = createSignal(false);
  const updateTrack = (patch: Partial<Track>) => useProjectStore.getState().updateTrack(props.track.id, patch);
  const groupOptions = () => props.groups.filter((group) => group.id !== props.track.id);
  const effectTotal = () => props.track.effects.filters.length;
  const sendTotal = () => props.track.sends?.length ?? 0;

  function setSolo(solo: boolean) {
    useProjectStore.getState().setTrackSolo(props.track.id, solo);
  }

  function setMute(mute: boolean) {
    useProjectStore.getState().setTrackMute(props.track.id, mute);
  }

  function addEffect() {
    useProjectStore.getState().addTrackEffect(props.track.id);
    useUiStore.getState().openTrackEffects(props.track.id);
  }

  async function bounceTrack() {
    if (props.track.kind === "group" || bounceBusy()) return;
    setBounceBusy(true);
    setBounceStatus("Bouncing");
    try {
      await bounceTrackInPlace(props.track.id);
      setBounceStatus("Bounced");
    } catch (error) {
      setBounceStatus(error instanceof Error ? error.message : "Bounce failed");
    } finally {
      setBounceBusy(false);
    }
  }

  function unfreezeTrack() {
    if (!props.track.freezeSource) return;
    try {
      unfreezeBouncedTrack(props.track.id);
      setBounceStatus("Unfrozen");
    } catch (error) {
      setBounceStatus(error instanceof Error ? error.message : "Unfreeze failed");
    }
  }

  return (
    <section class={styles.strip} data-mixer-strip={props.track.id}>
      <div class={styles.stripHeader}>
        <div>
          <div class={styles.stripName} title={props.track.name}>{props.track.name}</div>
          <div class={styles.stripKind}>{props.track.kind}</div>
        </div>
        <Icon name={props.track.kind === "group" ? "ph:folder-simple" : "ph:waveform"} size={14} decorative />
      </div>

      <div class={styles.meterPair} aria-label={`${props.track.name} stereo meter`} role="group">
        <span class={styles.meterLane} data-meter-channel="left">
          <span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter()?.leftPeak ?? meter()?.peak ?? 0)})` }} />
        </span>
        <span class={styles.meterLane} data-meter-channel="right">
          <span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter()?.rightPeak ?? meter()?.peak ?? 0)})` }} />
        </span>
      </div>

      <div class={styles.buttonRow}>
        <button
          type="button"
          class={`${styles.toggle} ${props.track.solo ? styles.toggleOn : ""}`}
          onClick={() => setSolo(!props.track.solo)}
          aria-pressed={props.track.solo}
        >
          S
        </button>
        <button
          type="button"
          class={`${styles.toggle} ${props.track.mute ? styles.toggleOn : ""}`}
          onClick={() => setMute(!props.track.mute)}
          aria-pressed={props.track.mute}
          disabled={props.track.solo}
        >
          M
        </button>
        <button
          type="button"
          class={`${styles.toggle} ${props.track.recordArmed ? styles.toggleOn : ""}`}
          onClick={() => updateTrack({ recordArmed: !props.track.recordArmed })}
          aria-pressed={props.track.recordArmed}
        >
          R
        </button>
        <button
          type="button"
          class={`${styles.toggle} ${props.track.inputMonitoring ? styles.toggleOn : ""}`}
          onClick={() => updateTrack({ inputMonitoring: !props.track.inputMonitoring })}
          aria-pressed={props.track.inputMonitoring}
        >
          In
        </button>
      </div>

      <div class={styles.controls}>
        <Slider
          label="Fader"
          layout="inline"
          min={-48}
          max={12}
          step={0.1}
          value={props.track.gainDb}
          onChange={(gainDb) => updateTrack({ gainDb })}
          readout={<span class={styles.readout}>{formatDb(props.track.gainDb)}</span>}
        />
        <Slider
          label="Pan"
          layout="inline"
          min={-1}
          max={1}
          step={0.01}
          value={props.track.pan}
          onChange={(pan) => updateTrack({ pan })}
          readout={<span class={styles.readout}>{formatPan(props.track.pan)}</span>}
        />
      </div>

      <div class={styles.routing}>
        <Select
          label="Output"
          layout="stacked"
          value={props.track.parentTrackId ?? "master"}
          onChange={(event) => updateTrack({ parentTrackId: event.currentTarget.value === "master" ? undefined : event.currentTarget.value as Id })}
        >
          <option value="master">Master</option>
          <For each={groupOptions()}>
            {(group) => (
              <option value={group.id} disabled={wouldCreateGroupCycle(props.track, group, props.groups)}>
                {group.name}
              </option>
            )}
          </For>
        </Select>
        <div class={styles.routeMeta}>
          <span>{sendTotal()} sends</span>
          <span>{effectTotal()} inserts</span>
          <span>{formatRouteLatency(props.track.effects.filters)}</span>
        </div>
      </div>

      <Show when={props.returnBuses.length > 0}>
        <div class={styles.sends}>
          <For each={props.returnBuses}>
            {(bus) => <SendControl track={props.track} bus={bus} />}
          </For>
        </div>
      </Show>

      <InsertList
        effects={props.track.effects.filters}
        onBypass={(effect) => useProjectStore.getState().updateTrackEffect(props.track.id, effect.id, { bypassed: !effect.bypassed })}
        onRemove={(effect) => useProjectStore.getState().removeTrackEffect(props.track.id, effect.id)}
        onMove={(effect, direction) => useProjectStore.getState().moveTrackEffect(props.track.id, effect.id, direction)}
      />

      <div class={styles.footerActions}>
        <Button size="sm" onClick={() => useUiStore.getState().openEditor({ kind: "track", trackId: props.track.id })}>Details</Button>
        <Show
          when={props.track.freezeSource}
          fallback={<Button size="sm" onClick={() => void bounceTrack()} disabled={props.track.kind === "group" || bounceBusy()}>Freeze</Button>}
        >
          <Button size="sm" onClick={unfreezeTrack}>Unfreeze</Button>
        </Show>
        <Button size="sm" onClick={addEffect}>Add Insert</Button>
      </div>
      <Show when={bounceStatus()}>
        <div class={styles.stripStatus}>{bounceStatus()}</div>
      </Show>
    </section>
  );
}

interface SendControlProps {
  track: Track;
  bus: ReturnBus;
}

function SendControl(props: SendControlProps) {
  const send = () => props.track.sends?.find((candidate) => candidate.busId === props.bus.id) ?? null;
  const effectiveSend = (): TrackSend => send() ?? { busId: props.bus.id, gainDb: -96, pan: 0, enabled: false };
  const updateSend = (patch: Partial<TrackSend>) => {
    useProjectStore.getState().upsertTrackSend(props.track.id, props.bus.id, patch);
  };

  return (
    <div class={styles.sendRow} data-mixer-send={`${props.track.id}:${props.bus.id}`}>
      <button
        type="button"
        class={`${styles.sendToggle} ${effectiveSend().enabled ? styles.toggleOn : ""}`}
        onClick={() => updateSend({ enabled: !effectiveSend().enabled, gainDb: send()?.gainDb ?? -12, pan: send()?.pan ?? 0 })}
        aria-pressed={effectiveSend().enabled}
        aria-label={`${props.track.name} send to ${props.bus.name}`}
      >
        {props.bus.name}
      </button>
      <Slider
        layout="bare"
        min={-96}
        max={12}
        step={0.1}
        value={effectiveSend().gainDb}
        disabled={!effectiveSend().enabled}
        onChange={(gainDb) => updateSend({ gainDb, enabled: true })}
        ariaLabel={`${props.bus.name} send level`}
        readout={<span class={styles.readout}>{formatDb(effectiveSend().gainDb)}</span>}
      />
      <Slider
        layout="bare"
        min={-1}
        max={1}
        step={0.01}
        value={effectiveSend().pan}
        disabled={!effectiveSend().enabled}
        onChange={(pan) => updateSend({ pan, enabled: true })}
        ariaLabel={`${props.bus.name} send pan`}
        readout={<span class={styles.readout}>{formatPan(effectiveSend().pan)}</span>}
      />
    </div>
  );
}

interface ReturnStripProps {
  bus: ReturnBus;
}

function ReturnStrip(props: ReturnStripProps) {
  const updateBus = (patch: Partial<ReturnBus>) => useProjectStore.getState().updateReturnBus(props.bus.id, patch);
  const addEffect = () => useProjectStore.getState().addReturnBusEffect(props.bus.id);

  return (
    <section class={`${styles.strip} ${styles.returnStrip}`} data-mixer-return={props.bus.id}>
      <div class={styles.stripHeader}>
        <div>
          <div class={styles.stripName} title={props.bus.name}>{props.bus.name}</div>
          <div class={styles.stripKind}>return</div>
        </div>
        <Icon name="ph:arrow-elbow-down-right" size={14} decorative />
      </div>
      <div class={styles.buttonRow}>
        <button
          type="button"
          class={`${styles.toggle} ${props.bus.mute ? styles.toggleOn : ""}`}
          onClick={() => updateBus({ mute: !props.bus.mute })}
          aria-pressed={props.bus.mute}
        >
          M
        </button>
      </div>
      <div class={styles.controls}>
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
      <div class={styles.routeMeta}>
        <span>{props.bus.effects.filters.length} inserts</span>
        <span>{formatRouteLatency(props.bus.effects.filters)}</span>
      </div>
      <InsertList
        effects={props.bus.effects.filters}
        onBypass={(effect) => useProjectStore.getState().updateReturnBusEffect(props.bus.id, effect.id, { bypassed: !effect.bypassed })}
        onRemove={(effect) => useProjectStore.getState().removeReturnBusEffect(props.bus.id, effect.id)}
        onMove={(effect, direction) => useProjectStore.getState().moveReturnBusEffect(props.bus.id, effect.id, direction)}
      />
      <div class={styles.footerActions}>
        <Button size="sm" onClick={addEffect}>Add Insert</Button>
        <Button size="sm" onClick={() => useProjectStore.getState().removeReturnBus(props.bus.id)}>Remove Return</Button>
      </div>
    </section>
  );
}

interface InsertListProps {
  effects: InsertEffect[];
  onBypass: (effect: InsertEffect) => void;
  onRemove: (effect: InsertEffect) => void;
  onMove: (effect: InsertEffect, direction: -1 | 1) => void;
}

function InsertList(props: InsertListProps) {
  return (
    <Show when={props.effects.length > 0}>
      <div class={styles.insertList} data-mixer-inserts>
        <For each={props.effects}>
          {(effect, index) => (
            <div class={`${styles.insertRow} ${effect.bypassed ? styles.insertBypassed : ""}`} data-mixer-insert={effect.id}>
              <button
                type="button"
                class={styles.insertName}
                onClick={() => props.onBypass(effect)}
                aria-pressed={!effect.bypassed}
              >
                {EFFECT_LABELS[effect.kind]}
              </button>
              <span class={styles.insertLatency}>{formatEffectLatency(effect)}</span>
              <button type="button" class={styles.insertAction} onClick={() => props.onMove(effect, -1)} disabled={index() === 0} aria-label="Move insert up">
                <Icon name="ph:caret-up" size={12} decorative />
              </button>
              <button type="button" class={styles.insertAction} onClick={() => props.onMove(effect, 1)} disabled={index() === props.effects.length - 1} aria-label="Move insert down">
                <Icon name="ph:caret-down" size={12} decorative />
              </button>
              <button type="button" class={styles.insertAction} onClick={() => props.onRemove(effect)} aria-label="Remove insert">
                <Icon name="ph:x" size={12} decorative />
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

interface MasterStripProps {
  inputGainDb: number;
  outputGainDb: number;
}

function MasterStrip(props: MasterStripProps) {
  const meter = createStoreSelector(useAnalyzerStore, (state) => state.master);
  return (
    <section class={styles.strip} data-mixer-master>
      <div class={styles.stripHeader}>
        <div>
          <div class={styles.stripName}>Master</div>
          <div class={styles.stripKind}>output</div>
        </div>
        <Icon name="ph:speaker-high" size={14} decorative />
      </div>
      <div class={styles.meterPair} aria-label="Master stereo meter" role="group">
        <span class={styles.meterLane} data-meter-channel="left">
          <span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter().peak)})` }} />
        </span>
        <span class={styles.meterLane} data-meter-channel="right">
          <span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(meter().peak)})` }} />
        </span>
      </div>
      <div class={styles.controls}>
        <Slider
          label="Input"
          layout="inline"
          min={-24}
          max={24}
          step={0.1}
          value={props.inputGainDb}
          onChange={(inputGainDb) => useProjectStore.getState().updateMasterChain({ inputGainDb })}
          readout={<span class={styles.readout}>{formatDb(props.inputGainDb)}</span>}
        />
        <Slider
          label="Output"
          layout="inline"
          min={-48}
          max={12}
          step={0.1}
          value={props.outputGainDb}
          onChange={(outputGainDb) => useProjectStore.getState().updateMasterChain({ outputGainDb })}
          readout={<span class={styles.readout}>{formatDb(props.outputGainDb)}</span>}
        />
      </div>
      <div class={styles.footerActions}>
        <Button size="sm" onClick={() => useUiStore.getState().openEditor({ kind: "eq" })}>Master EQ</Button>
      </div>
    </section>
  );
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

function routeLatencySamples(effects: InsertEffect[]): number {
  return effects.reduce((total, effect) => {
    if (effect.bypassed) return total;
    const latency = Number.isFinite(effect.latencySamples) ? Math.max(0, Number(effect.latencySamples)) : 0;
    return total + latency;
  }, 0);
}

function formatRouteLatency(effects: InsertEffect[]): string {
  const latency = routeLatencySamples(effects);
  return latency > 0 ? `${latency} smp` : "0 smp";
}

function wouldCreateGroupCycle(track: Track, candidateParent: Track, groups: Track[]): boolean {
  if (track.kind !== "group") return false;
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  let current: Track | undefined = candidateParent;
  while (current) {
    if (current.id === track.id) return true;
    current = current.parentTrackId ? groupsById.get(current.parentTrackId) : undefined;
  }
  return false;
}
