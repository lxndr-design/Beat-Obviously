import { For, Show, createMemo, createSignal } from "solid-js";
import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  aetherArrangementAutomationTargetLabel,
  aetherArrangementAutomationTargetMeta,
  clearTrackAutomationTarget,
  formatAetherArrangementAutomationValue,
  insertTrackAutomationPoint,
  removeTrackAutomationPoint,
  setTrackAutomationTargetCurve,
  trackAutomationCurve,
  trackHasAutomationTarget,
  updateTrackAutomationPoint,
  upsertTrackAutomationTarget,
  type AetherArrangementAutomationTarget,
} from "../../automation/aetherArrangementAutomation";
import { AUTOMATION_CURVES, automationCurveLabel, evaluateAutomationCurve } from "../../automation/curves";
import { Button, FloatingSelect, Modal, NumberInput, Slider } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useProjectStore, useUiStore } from "../../state/store";
import type { AutomationCurve, Id, MidiAutomationLane, MidiAutomationTarget, Track } from "../../state/types";
import styles from "./TrackAutomationEditor.module.css";

const GRAPH_WIDTH = 1000;
const GRAPH_HEIGHT = 330;
const GRAPH_LEFT = 64;
const GRAPH_RIGHT = 24;
const GRAPH_TOP = 24;
const GRAPH_BOTTOM = 48;

export function TrackAutomationEditor(props: { trackId: Id; target?: MidiAutomationTarget }) {
  let graphElement: SVGSVGElement | undefined;
  let draggingPointIndex: number | null = null;
  const tracks = createStoreSelector(useProjectStore, (state) => state.project.tracks);
  const projectLengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const timeSignature = createStoreSelector(useProjectStore, (state) => state.project.timeSignature);
  const track = createMemo(() => tracks().find((candidate) => candidate.id === props.trackId));
  const initialTarget = () => (props.target as AetherArrangementAutomationTarget | undefined)
    ?? (track()?.automation?.find((lane) => lane.points.length > 0)?.target as AetherArrangementAutomationTarget | undefined)
    ?? "filter.cutoff";
  const [target, setTarget] = createSignal<AetherArrangementAutomationTarget>(initialTarget());
  const [targetOpen, setTargetOpen] = createSignal(false);
  const [curveOpen, setCurveOpen] = createSignal(false);
  const [selectedPointIndex, setSelectedPointIndex] = createSignal<number | null>(null);
  const activeLane = createMemo(() => track()?.automation?.find((lane) => lane.target === target() && lane.points.length > 0));
  const targetMeta = createMemo(() => aetherArrangementAutomationTargetMeta(target()));
  const activeCurve = createMemo(() => trackAutomationCurve(track(), target()));
  const selectedPoint = createMemo(() => {
    const index = selectedPointIndex();
    return index == null ? undefined : activeLane()?.points[index];
  });
  const targetOptions = createMemo(() => AETHER_ARRANGEMENT_AUTOMATION_TARGETS.map((candidate) => ({
    value: candidate.target,
    label: `${candidate.label}${trackHasAutomationTarget(track(), candidate.target) ? " · Automated" : ""}`,
  })));
  const curveOptions = AUTOMATION_CURVES.map((curve) => ({ value: curve, label: automationCurveLabel(curve) }));
  const graphPoints = createMemo(() => (activeLane()?.points ?? []).map((point, index) => ({
    index,
    point,
    x: beatToGraphX(point.beat, projectLengthBeats()),
    y: valueToGraphY(point.value, targetMeta().min, targetMeta().max),
  })));
  const graphPath = createMemo(() => automationGraphPath(activeLane(), targetMeta().min, targetMeta().max, projectLengthBeats()));
  const barGrid = createMemo(() => graphBarGrid(projectLengthBeats(), timeSignature().num));
  const timeLabels = createMemo(() => [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const beat = projectLengthBeats() * ratio;
    return { x: beatToGraphX(beat, projectLengthBeats()), label: formatMusicalPosition(beat, timeSignature().num) };
  }));
  const valueLabels = createMemo(() => [1, 0.5, 0].map((ratio) => ({
    y: GRAPH_TOP + (1 - ratio) * graphInnerHeight(),
    label: formatAetherArrangementAutomationValue(target(), targetMeta().min + ratio * (targetMeta().max - targetMeta().min)),
  })));

  function close() {
    useUiStore.getState().closeEditor({ kind: "trackAutomation", trackId: props.trackId });
  }

  function updateTrackAutomation(nextTrack: Track) {
    useProjectStore.getState().updateTrack(props.trackId, { automation: nextTrack.automation });
  }

  function chooseTarget(value: string) {
    setTarget(value as AetherArrangementAutomationTarget);
    setSelectedPointIndex(null);
  }

  function addAutomationLane() {
    const current = track();
    if (!current) return;
    updateTrackAutomation(upsertTrackAutomationTarget(current, target(), projectLengthBeats()));
    setSelectedPointIndex(0);
  }

  function removeAutomationLane() {
    const current = track();
    if (!current) return;
    updateTrackAutomation(clearTrackAutomationTarget(current, target()));
    setSelectedPointIndex(null);
  }

  function setCurve(value: string) {
    const current = track();
    if (!current) return;
    updateTrackAutomation(setTrackAutomationTargetCurve(current, target(), value as AutomationCurve));
  }

  function graphValueFromPointer(event: PointerEvent, snapTime: boolean) {
    const rect = graphElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const graphX = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH;
    const graphY = ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT;
    const rawBeat = ((graphX - GRAPH_LEFT) / graphInnerWidth()) * projectLengthBeats();
    const beat = clamp(snapTime ? Math.round(rawBeat * 4) / 4 : rawBeat, 0, projectLengthBeats());
    const normalized = 1 - (graphY - GRAPH_TOP) / graphInnerHeight();
    const rawValue = targetMeta().min + clamp(normalized, 0, 1) * (targetMeta().max - targetMeta().min);
    const value = snapToStep(rawValue, targetMeta().min, targetMeta().max, targetMeta().step);
    return { beat, value };
  }

  function addPointAtPointer(event: MouseEvent) {
    if (!activeLane() || (event.target as Element).closest("[data-track-automation-point]")) return;
    const next = graphValueFromPointer(event as unknown as PointerEvent, true);
    const current = track();
    if (!next || !current) return;
    const nextTrack = insertTrackAutomationPoint(current, target(), projectLengthBeats(), next.beat, next.value);
    updateTrackAutomation(nextTrack);
    const lane = nextTrack.automation?.find((candidate) => candidate.target === target());
    const nextIndex = lane?.points.reduce((best, point, index) =>
      Math.abs(point.beat - next.beat) < Math.abs((lane.points[best]?.beat ?? Number.POSITIVE_INFINITY) - next.beat) ? index : best, 0) ?? null;
    setSelectedPointIndex(nextIndex);
  }

  function startPointDrag(index: number, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggingPointIndex = index;
    setSelectedPointIndex(index);
    try {
      (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    } catch {
      // Browser verifiers can synthesize pointers without an active capture target.
    }
  }

  function dragPoint(index: number, event: PointerEvent) {
    if (draggingPointIndex !== index) return;
    const next = graphValueFromPointer(event, event.shiftKey);
    const current = track();
    const lane = activeLane();
    if (!next || !current || !lane) return;
    const previousBeat = index > 0 ? (lane.points[index - 1]?.beat ?? 0) + 0.001 : 0;
    const nextBeat = index < lane.points.length - 1
      ? (lane.points[index + 1]?.beat ?? projectLengthBeats()) - 0.001
      : projectLengthBeats();
    updateTrackAutomation(updateTrackAutomationPoint(
      current,
      target(),
      projectLengthBeats(),
      index,
      clamp(next.beat, previousBeat, nextBeat),
      next.value,
    ));
  }

  function stopPointDrag(index: number, event: PointerEvent) {
    if (draggingPointIndex !== index) return;
    dragPoint(index, event);
    draggingPointIndex = null;
  }

  function updateSelectedPointBeat(beat: number) {
    const current = track();
    const point = selectedPoint();
    const index = selectedPointIndex();
    const lane = activeLane();
    if (!current || !point || index == null || !lane) return;
    const previousBeat = index > 0 ? (lane.points[index - 1]?.beat ?? 0) + 0.001 : 0;
    const nextBeat = index < lane.points.length - 1
      ? (lane.points[index + 1]?.beat ?? projectLengthBeats()) - 0.001
      : projectLengthBeats();
    updateTrackAutomation(updateTrackAutomationPoint(
      current,
      target(),
      projectLengthBeats(),
      index,
      clamp(beat, previousBeat, nextBeat),
      point.value,
    ));
  }

  function updateSelectedBar(bar: number) {
    const point = selectedPoint();
    if (!point) return;
    const position = musicalPositionParts(point.beat, timeSignature().num);
    updateSelectedPointBeat(clamp((Math.round(bar) - 1) * timeSignature().num + (position.beatInBar - 1), 0, projectLengthBeats()));
  }

  function updateSelectedBeatInBar(beatInBar: number) {
    const point = selectedPoint();
    if (!point) return;
    const position = musicalPositionParts(point.beat, timeSignature().num);
    updateSelectedPointBeat(clamp((position.bar - 1) * timeSignature().num + (beatInBar - 1), 0, projectLengthBeats()));
  }

  function updateSelectedValue(value: number) {
    const current = track();
    const point = selectedPoint();
    const index = selectedPointIndex();
    if (!current || !point || index == null) return;
    updateTrackAutomation(updateTrackAutomationPoint(current, target(), projectLengthBeats(), index, point.beat, value));
  }

  function deleteSelectedPoint() {
    const current = track();
    const index = selectedPointIndex();
    if (!current || index == null) return;
    updateTrackAutomation(removeTrackAutomationPoint(current, target(), index));
    setSelectedPointIndex(null);
  }

  return (
    <Show when={track()}>
      {(currentTrack) => (
        <Modal
          open
          title={`Track Automation · ${currentTrack().name}`}
          width="editor"
          scopeId={`track-automation-${props.trackId}`}
          onClose={close}
          footer={<Button variant="primary" onClick={close}>Done</Button>}
        >
          <div class={styles.editor} aria-label="Track automation editor">
            <div class={styles.toolbar}>
              <FloatingSelect
                className={styles.parameterSelect}
                label="Parameter"
                layout="inline"
                value={target()}
                options={targetOptions()}
                open={targetOpen()}
                ariaLabel="Automation parameter"
                onOpenChange={setTargetOpen}
                onChange={chooseTarget}
              />
              <FloatingSelect
                className={styles.curveSelect}
                label="Curve"
                layout="inline"
                value={activeCurve()}
                options={curveOptions}
                open={curveOpen()}
                disabled={!activeLane()}
                ariaLabel="Automation curve"
                onOpenChange={setCurveOpen}
                onChange={setCurve}
              />
              <span class={styles.toolbarSpacer} />
              <Show
                when={activeLane()}
                fallback={<Button variant="primary" data-track-automation-add="toolbar" onClick={addAutomationLane}>Add automation</Button>}
              >
                <Button variant="ghost" onClick={removeAutomationLane}>Remove automation</Button>
              </Show>
            </div>

            <div class={styles.explanation}>
              <strong>{aetherArrangementAutomationTargetLabel(target())}</strong>
              <span>Horizontal position is musical time. Vertical position is the parameter value. Double-click to add a point; drag a point to shape the change.</span>
            </div>

            <div class={styles.graphFrame}>
              <svg
                ref={graphElement}
                class={styles.graph}
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                preserveAspectRatio="none"
                role="application"
                aria-label={`${aetherArrangementAutomationTargetLabel(target())} automation graph`}
                onDblClick={addPointAtPointer}
              >
                <rect class={styles.graphBackground} x="0" y="0" width={GRAPH_WIDTH} height={GRAPH_HEIGHT} />
                <For each={[0, 0.25, 0.5, 0.75, 1]}>
                  {(ratio) => (
                    <line
                      class={ratio === 0 || ratio === 1 ? styles.valueGridMajor : styles.valueGrid}
                      x1={GRAPH_LEFT}
                      x2={GRAPH_WIDTH - GRAPH_RIGHT}
                      y1={GRAPH_TOP + ratio * graphInnerHeight()}
                      y2={GRAPH_TOP + ratio * graphInnerHeight()}
                    />
                  )}
                </For>
                <For each={barGrid()}>
                  {(bar) => (
                    <line
                      class={bar.major ? styles.timeGridMajor : styles.timeGrid}
                      x1={bar.x}
                      x2={bar.x}
                      y1={GRAPH_TOP}
                      y2={GRAPH_HEIGHT - GRAPH_BOTTOM}
                    />
                  )}
                </For>
                <For each={valueLabels()}>
                  {(label) => <text class={styles.valueLabel} x={GRAPH_LEFT - 9} y={label.y + 4}>{label.label}</text>}
                </For>
                <For each={timeLabels()}>
                  {(label) => <text class={styles.timeLabel} x={label.x} y={GRAPH_HEIGHT - 18}>{label.label}</text>}
                </For>
                <Show when={activeLane()}>
                  <path class={styles.automationFill} d={`${graphPath()} L ${GRAPH_WIDTH - GRAPH_RIGHT} ${GRAPH_HEIGHT - GRAPH_BOTTOM} L ${GRAPH_LEFT} ${GRAPH_HEIGHT - GRAPH_BOTTOM} Z`} />
                  <path class={styles.automationLine} d={graphPath()} />
                  <For each={graphPoints()}>
                    {(graphPoint) => (
                      <g>
                        <circle
                          classList={{
                            [styles.pointHit]: true,
                            [styles.pointHitSelected]: selectedPointIndex() === graphPoint.index,
                          }}
                          cx={graphPoint.x}
                          cy={graphPoint.y}
                          r="13"
                          data-track-automation-point={graphPoint.index}
                          aria-label={`${formatMusicalPosition(graphPoint.point.beat, timeSignature().num)}, ${formatAetherArrangementAutomationValue(target(), graphPoint.point.value)}`}
                          onPointerDown={(event) => startPointDrag(graphPoint.index, event)}
                          onPointerMove={(event) => dragPoint(graphPoint.index, event)}
                          onPointerUp={(event) => stopPointDrag(graphPoint.index, event)}
                          onPointerCancel={() => { draggingPointIndex = null; }}
                        />
                        <circle class={styles.point} cx={graphPoint.x} cy={graphPoint.y} r="5" aria-hidden="true" />
                      </g>
                    )}
                  </For>
                </Show>
              </svg>
              <Show when={!activeLane()}>
                <div class={styles.emptyGraph}>
                  <strong>No {aetherArrangementAutomationTargetLabel(target()).toLowerCase()} automation</strong>
                  <span>Add automation to create a flat starting line, then shape it with points.</span>
                  <Button variant="primary" data-track-automation-add="empty" onClick={addAutomationLane}>Add automation</Button>
                </div>
              </Show>
            </div>

            <div class={styles.graphHint}>Bars and beats run left to right · Hold Shift while dragging to snap to 1/4 beat</div>

            <Show
              when={selectedPoint()}
              fallback={<div class={styles.pointInspectorEmpty}>Select a point to edit its exact musical position and value.</div>}
            >
              {(point) => {
                const position = () => musicalPositionParts(point().beat, timeSignature().num);
                return (
                  <div class={styles.pointInspector}>
                    <div class={styles.pointSummary}>
                      <strong>Selected point</strong>
                      <span>
                        {formatMusicalPosition(point().beat, timeSignature().num)} · {aetherArrangementAutomationTargetLabel(target())} {formatAetherArrangementAutomationValue(target(), point().value)}
                      </span>
                    </div>
                    <NumberInput
                      layout="inline"
                      label="Bar"
                      value={position().bar}
                      min={1}
                      max={Math.ceil(projectLengthBeats() / timeSignature().num)}
                      step={1}
                      onChange={updateSelectedBar}
                    />
                    <NumberInput
                      layout="inline"
                      label="Beat in bar"
                      value={position().beatInBar}
                      min={1}
                      max={timeSignature().num}
                      step={0.25}
                      onChange={updateSelectedBeatInBar}
                    />
                    <Slider
                      className={styles.pointValue}
                      layout="inline"
                      label={aetherArrangementAutomationTargetLabel(target())}
                      value={point().value}
                      min={targetMeta().min}
                      max={targetMeta().max}
                      step={targetMeta().step}
                      readout={formatAetherArrangementAutomationValue(target(), point().value)}
                      onChange={updateSelectedValue}
                    />
                    <Button variant="ghost" onClick={deleteSelectedPoint}>Delete point</Button>
                  </div>
                );
              }}
            </Show>
          </div>
        </Modal>
      )}
    </Show>
  );
}

function graphInnerWidth() {
  return GRAPH_WIDTH - GRAPH_LEFT - GRAPH_RIGHT;
}

function graphInnerHeight() {
  return GRAPH_HEIGHT - GRAPH_TOP - GRAPH_BOTTOM;
}

function beatToGraphX(beat: number, projectLengthBeats: number) {
  return GRAPH_LEFT + (clamp(beat, 0, projectLengthBeats) / Math.max(0.001, projectLengthBeats)) * graphInnerWidth();
}

function valueToGraphY(value: number, min: number, max: number) {
  const normalized = (clamp(value, min, max) - min) / Math.max(0.000001, max - min);
  return GRAPH_TOP + (1 - normalized) * graphInnerHeight();
}

function automationGraphPath(lane: MidiAutomationLane | undefined, min: number, max: number, projectLengthBeats: number) {
  if (!lane?.points.length) return "";
  const points = [...lane.points].sort((a, b) => a.beat - b.beat);
  const first = points[0]!;
  const commands = [`M ${beatToGraphX(first.beat, projectLengthBeats).toFixed(2)} ${valueToGraphY(first.value, min, max).toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    for (let sample = 1; sample <= 20; sample += 1) {
      const t = sample / 20;
      const beat = start.beat + (end.beat - start.beat) * t;
      const value = evaluateAutomationCurve(start.curve, start.value, end.value, t);
      commands.push(`L ${beatToGraphX(beat, projectLengthBeats).toFixed(2)} ${valueToGraphY(value, min, max).toFixed(2)}`);
    }
  }
  return commands.join(" ");
}

function graphBarGrid(projectLengthBeats: number, beatsPerBar: number) {
  const barCount = Math.ceil(projectLengthBeats / Math.max(1, beatsPerBar));
  const stride = Math.max(1, Math.ceil(barCount / 128));
  return Array.from({ length: Math.floor(barCount / stride) + 1 }, (_, index) => {
    const bar = index * stride;
    return {
      x: beatToGraphX(bar * beatsPerBar, projectLengthBeats),
      major: bar % Math.max(1, stride * 4) === 0,
    };
  });
}

function musicalPositionParts(beat: number, beatsPerBar: number) {
  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const safeBeat = Math.max(0, beat);
  return {
    bar: Math.floor(safeBeat / safeBeatsPerBar) + 1,
    beatInBar: round(safeBeat % safeBeatsPerBar + 1, 0.001),
  };
}

function formatMusicalPosition(beat: number, beatsPerBar: number) {
  const position = musicalPositionParts(beat, beatsPerBar);
  return `Bar ${position.bar} · Beat ${position.beatInBar}`;
}

function snapToStep(value: number, min: number, max: number, step: number) {
  const snapped = Math.round((value - min) / Math.max(0.000001, step)) * step + min;
  return clamp(Number(snapped.toFixed(8)), min, max);
}

function round(value: number, step: number) {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
